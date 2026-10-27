/* The one-screen quick report (brief §15.2): location chip → 2×2 type grid → suggested categories → camera strip →
   describe (with mic) → fixed on the spot → danger now → anonymous → Submit. Saves to the phone first and shows the
   pending number; the case number appears when sync returns it. Drafts autosave and survive a crash. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ObservationCreate, ObservationType, ReporterType } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Chip, ChipBar, Field, Input, Pill, Select, Sheet, Textarea, Toggle, useToast, SuccessMark, Skeleton } from "../../shared/ui";
import { IconThumbUp, IconHand, IconHazard, IconNearMiss, IconMapPin, IconClock, IconStop, IconEyeOff, IconForward, IconCheck } from "../../shared/icons";
import { useBeforeUnload, useGeo } from "../../shared/hooks";
import { fmtDateTime } from "../../shared/format";
import { isNative } from "../../shared/api";
import { uuid } from "../../shared/storage";
import { useSession } from "../session";
import { useDraft, useObservations, useRefData, useActions } from "../offline/store";
import { getOutbox, getMedia, deleteOutbox } from "../offline/db";
import { submitObservation } from "../offline/commands";
import { PhotoStrip, VoiceNoteButton, type PhotoDraft, type VoiceDraft, photoBytes } from "../components/media";
import { SyncBanner } from "../components/common";
import { areasOf, categoriesFor, nearestSite, readLastLocation, suggestedCategories, writeLastLocation, obsTitle, TYPE_CLASS } from "../lib";

const TRADES = ["civil", "steel_fixing", "shuttering", "scaffolding", "electrical", "welding", "painting", "plumbing", "rigging", "operators", "housekeeping", "security"];
export const MAX_QUICK_PHOTOS = 3;

interface ReportDraft {
  clientUuid: string;
  capturedAt: string;
  siteId: string | null;
  areaId: string | null;
  assetId: string | null;
  type: ObservationType | null;
  categoryCodes: string[];
  description: string;
  fixedOnSpot: boolean;
  immediateAction: string;
  imminentDanger: boolean;
  anonymous: boolean;
  employerInvolvedId: string | null;
  trade: string;
  extra: Record<string, unknown>;
  photos: PhotoDraft[];
  voice: VoiceDraft | null;
  touchedCategory: boolean;
}
const fresh = (): ReportDraft => ({
  clientUuid: uuid(), capturedAt: new Date().toISOString(), siteId: null, areaId: null, assetId: null, type: null, categoryCodes: [], description: "", fixedOnSpot: false,
  immediateAction: "", imminentDanger: false, anonymous: false, employerInvolvedId: null, trade: "", extra: {}, photos: [], voice: null, touchedCategory: false,
});

export default function QuickReport() {
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { me } = useSession();
  const ref = useRefData();
  const { data: observations } = useObservations();
  const { data: actions } = useActions();
  const geo = useGeo(true);
  const fixId = params.get("fix");
  const { value: d, set, ready, restored, clear, dirty } = useDraft<ReportDraft>(fixId ? `quickreport:fix:${fixId}` : "quickreport", fresh());
  const [submitted, setSubmitted] = useState<{ clientUuid: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreCats, setMoreCats] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const located = useRef(false);
  useBeforeUnload(dirty && !submitted);

  // 1. location: QR link → draft → last used → nearest site by GPS
  useEffect(() => {
    if (!ready || !me || located.current) return;
    const qSite = params.get("site"), qArea = params.get("area"), qAsset = params.get("asset");
    if (qSite) {
      located.current = true;
      const area = qArea ?? ref.assets.find((a) => a.id === qAsset)?.areaId ?? null;
      set((p) => ({ ...p, siteId: qSite, areaId: area, assetId: qAsset ?? null }));
      return;
    }
    if (d.siteId) { located.current = true; return; }
    const last = readLastLocation(me.id);
    if (last && ref.sites.some((s) => s.id === last.siteId)) { located.current = true; set((p) => ({ ...p, siteId: last.siteId, areaId: last.areaId, assetId: last.assetId ?? null })); return; }
    if (geo.state === "ok") {
      const near = nearestSite(ref.sites, geo.lat, geo.lng) ?? me.sites[0] ?? null;
      located.current = true;
      if (near) set((p) => ({ ...p, siteId: near.id, areaId: areasOf(ref, near.id)[0]?.id ?? null }));
      return;
    }
    if (geo.state === "denied" || geo.state === "unavailable" || ref.sites.length === 1) {
      const s = me.sites[0] ?? ref.sites[0];
      located.current = true;
      if (s) set((p) => ({ ...p, siteId: s.id, areaId: areasOf(ref, s.id)[0]?.id ?? null }));
    }
  }, [ready, me, params, d.siteId, geo.state, geo.lat, geo.lng, ref, set]);

  // "Fix and resend": load the failed command's payload and media into the form
  useEffect(() => {
    if (!fixId || !ready || d.type) return;
    (async () => {
      const item = await getOutbox(fixId);
      if (!item || item.entityType !== "observation" || item.op !== "create") return;
      const p = item.payload as ObservationCreate;
      const photos: PhotoDraft[] = [];
      let voice: VoiceDraft | null = null;
      for (const m of p.media) {
        const bytes = await getMedia(m.clientUuid);
        if (!bytes?.blob) continue;
        if (m.kind === "photo") photos.push({ id: uuid(), original: bytes.blob, blob: bytes.blob, ref: m, blur: [] });
        if (m.kind === "audio") voice = { blob: bytes.blob, ref: m, durationS: m.durationS ?? 0 };
      }
      set((prev) => ({
        ...prev, clientUuid: p.clientUuid, capturedAt: p.capturedAt, siteId: p.siteId, areaId: p.areaId, assetId: p.assetId ?? null, type: p.type, categoryCodes: p.categoryCodes, description: p.description,
        fixedOnSpot: p.fixedOnSpot, immediateAction: p.immediateAction ?? "", imminentDanger: p.imminentDanger, anonymous: p.anonymous, employerInvolvedId: p.employerInvolvedId ?? null, trade: p.trade ?? "",
        extra: p.extra ?? {}, photos, voice, touchedCategory: true,
      }));
      located.current = true;
      toast.show(t("outbox.fixLoaded", { reason: item.lastError ?? "" }));
    })();
  }, [fixId, ready, d.type, set, toast, t]);

  const site = ref.sites.find((s) => s.id === d.siteId) ?? null;
  const areas = useMemo(() => areasOf(ref, d.siteId), [ref, d.siteId]);
  const area = areas.find((a) => a.id === d.areaId) ?? null;
  const asset = ref.assets.find((a) => a.id === d.assetId) ?? null;
  const cats = useMemo(() => categoriesFor(ref, site, d.type), [ref, site, d.type]);
  const suggested = useMemo(() => suggestedCategories(cats, observations, d.siteId, d.areaId), [cats, observations, d.siteId, d.areaId]);
  const visibleCats = moreCats ? cats : [...suggested, ...cats.filter((c) => d.categoryCodes.includes(c.code) && !suggested.includes(c))];
  const contractorsAtSite = ref.contractors.filter((c) => c.active && (c.isOwnCompany || !d.siteId || c.siteIds.includes(d.siteId)));
  const extraFields = cats.filter((c) => d.categoryCodes.includes(c.code)).flatMap((c) => c.extraFields.map((f) => ({ ...f, cat: c })));

  const chooseType = (type: ObservationType) => {
    set((p) => {
      const next = { ...p, type };
      const allowed = categoriesFor(ref, site, type);
      next.categoryCodes = p.categoryCodes.filter((c) => allowed.some((a) => a.code === c));
      if (!p.touchedCategory && next.categoryCodes.length === 0) {
        const first = suggestedCategories(allowed, observations, p.siteId, p.areaId)[0];
        if (first) next.categoryCodes = [first.code];
      }
      return next;
    });
  };
  const toggleCat = (code: string) => set((p) => ({ ...p, touchedCategory: true, categoryCodes: p.categoryCodes.includes(code) ? p.categoryCodes.filter((c) => c !== code) : [...p.categoryCodes, code] }));

  const canSubmit = !!d.type && d.categoryCodes.length > 0 && (d.photos.length > 0 || d.description.trim().length > 0) && !!d.siteId;

  const submit = useCallback(async () => {
    const errs: Record<string, string> = {};
    if (!d.siteId) errs.location = t("report.needSite");
    if (!d.areaId && geo.state !== "ok") errs.location = t("report.needArea");
    if (!d.type) errs.type = t("report.needType");
    if (d.categoryCodes.length === 0) errs.category = t("report.needCategory");
    if (d.photos.length === 0 && !d.description.trim()) errs.description = t("report.needPhotoOrText");
    if (d.description.length > 500) errs.description = t("report.tooLong");
    if (d.fixedOnSpot && !d.immediateAction.trim()) errs.immediateAction = t("report.needWhatYouDid");
    for (const f of extraFields) if (f.required && (d.extra[f.key] === undefined || d.extra[f.key] === "" || d.extra[f.key] === null)) errs[`extra.${f.key}`] = t("common.required");
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error(t("error.validation")); return; }
    setBusy(true);
    const started = performance.now();
    try {
      const own = ref.contractors.find((c) => c.isOwnCompany);
      const reporterType: ReporterType = !me?.employerId || (own && own.id === me.employerId) ? "employee" : "contractor";
      const create: ObservationCreate = {
        clientUuid: d.clientUuid, siteId: d.siteId!, areaId: d.areaId, assetId: d.assetId, lat: geo.lat, lng: geo.lng, accuracyM: geo.accuracyM, capturedAt: d.capturedAt,
        channel: isNative ? "app" : "web", reporterType, anonymous: d.anonymous, type: d.type!, categoryCodes: d.categoryCodes, description: d.description.trim(), descriptionLang: lang,
        fixedOnSpot: d.fixedOnSpot, immediateAction: d.fixedOnSpot ? d.immediateAction.trim() : undefined, imminentDanger: d.imminentDanger, employerInvolvedId: d.employerInvolvedId, trade: d.trade || undefined,
        extra: Object.keys(d.extra).length ? d.extra : undefined, media: [...d.photos.map((p) => p.ref), ...(d.voice ? [d.voice.ref] : [])],
      };
      const title = obsTitle(create, ref, t, pick);
      const bytes = [...d.photos.map(photoBytes), ...(d.voice ? [{ ref: d.voice.ref, blob: d.voice.blob }] : [])];
      if (fixId) await deleteOutbox([fixId]);
      await submitObservation(create, bytes, me, area ? area.name : null, title);
      if (me) writeLastLocation(me.id, { siteId: d.siteId!, areaId: d.areaId, assetId: d.assetId });
      await clear();
      setSubmitted({ clientUuid: d.clientUuid, title });
      const ms = Math.round(performance.now() - started);
      if (ms > 2000) console.warn(`[safeworks] local save took ${ms} ms`);
    } catch (e) {
      toast.error(t("report.saveFailed", { reason: e instanceof Error ? e.message : String(e) }));
    } finally { setBusy(false); }
  }, [d, geo, extraFields, t, toast, ref, me, lang, pick, area, fixId, clear]);

  const discard = () => {
    const snapshot = d;
    void clear().then(() => set(fresh()));
    toast.undoable(t("report.discarded"), () => { /* draft already cleared */ }, () => set(snapshot));
  };

  if (submitted) return <Submitted clientUuid={submitted.clientUuid} title={submitted.title} onAnother={() => { setSubmitted(null); set({ ...fresh(), siteId: d.siteId, areaId: d.areaId }); }} />;
  if (!ready) return <div className="page"><Skeleton lines={6} /></div>;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <SyncBanner compact />
      {restored && !fixId ? <div className="hint-box" style={{ marginBottom: 10 }}>{t("report.draftRestored")} <button type="button" className="btn ghost sm" onClick={discard}>{t("report.discard")}</button></div> : null}

      {/* 1. location */}
      <button type="button" className="loc-chip" onClick={() => setLocOpen(true)} aria-label={t("report.changeLocation")} data-testid="loc-chip">
        <IconMapPin />
        <span className="txt">
          <b>{site ? `${site.code} · ${pick(site.name)}` : t("report.chooseLocation")}</b>
          <small>{area ? pick(area.name) : site ? t("report.chooseArea") : ""}{asset ? ` · ${asset.tagNo}` : ""}</small>
        </span>
        <IconForward size={18} />
      </button>
      {errors.location ? <div className="error small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }}>{errors.location}</div> : null}
      <div className="locked" style={{ margin: "8px 0 14px" }}>
        <Pill><IconClock size={13} /> {fmtDateTime(d.capturedAt, lang)}</Pill>
        <Pill tone={geo.state === "ok" ? "green" : geo.state === "locating" ? "blue" : "grey"}>
          <IconMapPin size={13} /> {geo.state === "ok" ? `${t("common.gps")} ${t("common.gpsAcc", { m: geo.accuracyM })}` : geo.state === "locating" ? t("report.locating") : t("common.gpsNone")}
        </Pill>
        <span className="small muted">{t("report.locked")}</span>
      </div>

      {/* 2. type */}
      <div className="label" style={{ marginBottom: 6 }}>{t("report.type")}<span className="req" aria-hidden>*</span></div>
      <div className="type-grid" role="group" aria-label={t("report.type")}>
        {([["good_practice", <IconThumbUp key="g" />], ["unsafe_act", <IconHand key="a" />], ["unsafe_condition", <IconHazard key="c" />], ["near_miss", <IconNearMiss key="n" />]] as [ObservationType, JSX.Element][]).map(([ty, icon]) => (
          <button key={ty} type="button" className={`type-btn ${TYPE_CLASS[ty]}`} aria-pressed={d.type === ty} onClick={() => chooseType(ty)} data-testid={`type-${ty}`}>
            <span className="ico">{icon}</span>
            <span>{t(`type.${ty}`)}</span>
          </button>
        ))}
      </div>
      {errors.type ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }}>{errors.type}</div> : null}

      {/* 3. categories */}
      <div className="label" style={{ margin: "14px 0 6px" }}>{t("common.categories")}<span className="req" aria-hidden>*</span> <span className="muted small">{t("report.catHint")}</span></div>
      <div className="cat-chips" role="group" aria-label={t("common.categories")}>
        {visibleCats.map((c) => <Chip key={c.code} size="lg" on={d.categoryCodes.includes(c.code)} onClick={() => toggleCat(c.code)} data-testid={`cat-${c.code}`}>{pick(c.name)}</Chip>)}
        {cats.length > visibleCats.length || moreCats ? <Chip size="lg" onClick={() => setMoreCats((m) => !m)}>{moreCats ? t("common.less") : t("common.more")} ›</Chip> : null}
      </div>
      {errors.category ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }}>{errors.category}</div> : null}
      {extraFields.length ? (
        <div style={{ marginTop: 10 }}>
          {extraFields.map((f) => (
            <Field key={f.key} label={pick(f.label)} required={f.required} error={errors[`extra.${f.key}`]}>
              {f.type === "choice" ? (
                <Select value={String(d.extra[f.key] ?? "")} onChange={(e) => set((p) => ({ ...p, extra: { ...p.extra, [f.key]: e.target.value } }))}>
                  <option value="">{t("common.choose")}</option>
                  {(f.options ?? []).map((o, i) => <option key={i} value={o.en}>{pick(o)}</option>)}
                </Select>
              ) : f.type === "boolean" ? (
                <Toggle label={pick(f.label)} checked={!!d.extra[f.key]} onChange={(v) => set((p) => ({ ...p, extra: { ...p.extra, [f.key]: v } }))} />
              ) : (
                <Input type={f.type === "number" ? "number" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} value={String(d.extra[f.key] ?? "")} onChange={(e) => set((p) => ({ ...p, extra: { ...p.extra, [f.key]: f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value } }))} />
              )}
            </Field>
          ))}
        </div>
      ) : null}

      {/* 4. photos */}
      <div style={{ marginTop: 14 }}>
        <PhotoStrip photos={d.photos} onChange={(photos) => set((p) => ({ ...p, photos }))} max={MAX_QUICK_PHOTOS} purpose="before" geo={geo} big label={t("report.photos")} />
      </div>

      {/* 5. describe */}
      <div style={{ marginTop: 14 }}>
        <Field label={t("report.describe")} hint={t("report.describeHint")} error={errors.description}>
          <div className="mic-row">
            <div>
              <Textarea rows={2} maxLength={500} value={d.description} onChange={(e) => set((p) => ({ ...p, description: e.target.value }))} placeholder={t("report.describePlaceholder")} data-testid="description" />
            </div>
            <VoiceNoteButton value={d.voice} onChange={(voice) => set((p) => ({ ...p, voice }))} />
          </div>
        </Field>
      </div>

      {/* 6. fixed on the spot */}
      <Toggle label={t("report.fixedOnSpot")} hint={t("report.fixedHint")} checked={d.fixedOnSpot} onChange={(v) => set((p) => ({ ...p, fixedOnSpot: v }))} />
      {d.fixedOnSpot ? (
        <Field label={t("report.whatDidYouDo")} required error={errors.immediateAction}>
          <Textarea rows={2} maxLength={300} value={d.immediateAction} onChange={(e) => set((p) => ({ ...p, immediateAction: e.target.value }))} />
        </Field>
      ) : null}

      {/* 7. danger now */}
      <div className={d.imminentDanger ? "danger-toggle" : undefined} style={{ marginTop: 4 }}>
        <Toggle danger label={<span className="row" style={{ gap: 6 }}><IconStop size={18} /> {t("report.dangerNow")}</span>} hint={t("report.dangerHint")} checked={d.imminentDanger} onChange={(v) => set((p) => ({ ...p, imminentDanger: v }))} />
      </div>

      {/* 8. anonymous */}
      <Toggle label={<span className="row" style={{ gap: 6 }}><IconEyeOff size={18} /> {t("report.anonymous")}</span>} hint={t("report.anonymousHint")} checked={d.anonymous} onChange={(v) => set((p) => ({ ...p, anonymous: v }))} />

      <button type="button" className="btn ghost sm" onClick={() => setMoreOpen((m) => !m)} aria-expanded={moreOpen} style={{ marginTop: 6 }}>{moreOpen ? t("common.less") : t("report.moreDetails")}</button>
      {moreOpen ? (
        <div style={{ marginTop: 8 }}>
          <Field label={t("report.employerInvolved")} optional>
            <Select value={d.employerInvolvedId ?? ""} onChange={(e) => set((p) => ({ ...p, employerInvolvedId: e.target.value || null }))}>
              <option value="">{t("common.none")}</option>
              {contractorsAtSite.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isOwnCompany ? ` (${t("common.ownCompany")})` : ""}</option>)}
            </Select>
          </Field>
          <Field label={t("common.trade")} optional>
            <Select value={d.trade} onChange={(e) => set((p) => ({ ...p, trade: e.target.value }))}>
              <option value="">{t("common.none")}</option>
              {TRADES.map((tr) => <option key={tr} value={tr}>{t(`trade.${tr}`)}</option>)}
            </Select>
          </Field>
          <p className="small muted">{t("report.describeActHint")}</p>
        </div>
      ) : null}

      {/* 9. submit */}
      <div className="submit-bar">
        <Button variant="primary" block size="lg" disabled={!canSubmit} loading={busy} onClick={submit} data-testid="submit">{t("report.submit")}</Button>
        {!canSubmit ? <p className="small muted" style={{ textAlign: "center", margin: "6px 0 0" }}>{t("report.submitHint")}</p> : null}
        {dirty && !restored ? <p style={{ textAlign: "center", margin: "6px 0 0" }}><button type="button" className="btn ghost sm" onClick={discard}>{t("report.discard")}</button></p> : null}
      </div>

      {locOpen ? (
        <LocationSheet siteId={d.siteId} areaId={d.areaId} assetId={d.assetId} onClose={() => setLocOpen(false)} onPick={(siteId, areaId, assetId) => { set((p) => ({ ...p, siteId, areaId, assetId })); setLocOpen(false); }} />
      ) : null}
    </div>
  );
}

export function LocationSheet({ siteId, areaId, assetId, onClose, onPick }: { siteId: string | null; areaId: string | null; assetId: string | null; onClose: () => void; onPick: (siteId: string, areaId: string | null, assetId: string | null) => void }) {
  const { t, pick } = useI18n();
  const { me } = useSession();
  const ref = useRefData();
  const [s, setS] = useState(siteId ?? me?.sites[0]?.id ?? "");
  const [a, setA] = useState(areaId ?? "");
  const [as, setAs] = useState(assetId ?? "");
  const sites = me?.sites.length ? me.sites : ref.sites;
  const areas = areasOf(ref, s || null);
  const assets = ref.assets.filter((x) => x.siteId === s && (!a || x.areaId === a || x.areaId === null));
  return (
    <Sheet title={t("report.changeLocation")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!s} onClick={() => onPick(s, a || null, as || null)}>{t("common.done")}</Button></>}>
      <Field label={t("common.site")} required>
        <Select value={s} onChange={(e) => { setS(e.target.value); setA(""); setAs(""); }} data-testid="loc-site">
          <option value="">{t("common.choose")}</option>
          {sites.map((x) => <option key={x.id} value={x.id}>{x.code} · {pick(x.name)}</option>)}
        </Select>
      </Field>
      <Field label={t("common.area")} hint={t("report.areaHint")}>
        <ChipBar wrap>
          {areas.map((x) => <Chip key={x.id} on={a === x.id} onClick={() => { setA(a === x.id ? "" : x.id); setAs(""); }}>{pick(x.name)}</Chip>)}
          {areas.length === 0 ? <span className="small muted">{t("report.noAreas")}</span> : null}
        </ChipBar>
      </Field>
      {assets.length ? (
        <Field label={t("common.asset")} optional>
          <Select value={as} onChange={(e) => setAs(e.target.value)}>
            <option value="">{t("common.none")}</option>
            {assets.map((x) => <option key={x.id} value={x.id}>{x.tagNo} · {t(`assetClass.${x.assetClass}`)}</option>)}
          </Select>
        </Field>
      ) : null}
    </Sheet>
  );
}

function Submitted({ clientUuid, title, onAnother }: { clientUuid: string; title: string; onAnother: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { data: observations } = useObservations();
  const rec = observations.find((o) => o.clientUuid === clientUuid);
  const caseNo = rec?.caseNo || "";
  return (
    <div className="page">
      <div className="success-screen" data-testid="submitted">
        <SuccessMark />
        <h1 style={{ fontSize: 24 }}>{t("report.savedTitle")}</h1>
        <div className={`case${caseNo ? "" : " pending"}`} data-testid="case-no">{caseNo || t("common.pendingNumber")}</div>
        <p className="muted">{caseNo ? t("report.savedSynced") : t("report.savedPending")}</p>
        <p className="small muted" style={{ maxWidth: 360 }}>{title}</p>
        <p>{t("report.willTell")}</p>
        <div className="btn-group" style={{ justifyContent: "center" }}>
          <Button variant="primary" size="lg" onClick={onAnother}><IconCheck size={18} /> {t("report.another")}</Button>
          <Button size="lg" onClick={() => nav(`/o/${rec?.id ?? clientUuid}`)}>{t("report.view")}</Button>
        </div>
        <Button variant="ghost" onClick={() => nav("/")}>{t("nav.home")}</Button>
      </div>
    </div>
  );
}
