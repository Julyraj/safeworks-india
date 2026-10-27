/* The no-login report form behind an area or asset QR poster (brief §5.1, §15.2, §8.9): language first, site and area
   pre-filled, type → categories → up to 3 photos (blur available) → describe → fixed on the spot → danger now →
   anonymous (or optional name + phone) → Submit. Honeypot field for bots. Works once loaded even when the network
   drops: the report is queued in IndexedDB and sent when the browser is online again. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Lang, ObservationType, PublicStatus, QrInfo, QrObservationCreate, QrObservationResponse } from "../shared/types";
import { useI18n, LANG_NAMES, LANGS } from "../shared/i18n";
import { Button, Card, Chip, ErrorCard, Field, Input, Pill, Progress, Skeleton, SuccessMark, Textarea, Timeline, Toggle, useToast } from "../shared/ui";
import { IconThumbUp, IconHand, IconHazard, IconNearMiss, IconMapPin, IconStop, IconEyeOff, IconCopy, IconWifiOff, IconLanguage, IconCheck } from "../shared/icons";
import { createApi, ApiError, errorKey } from "../shared/api";
import { useGeo, useBeforeUnload } from "../shared/hooks";
import { copyText, uuid, safeGet } from "../shared/storage";
import { fmtDateTime, relative } from "../shared/format";
import { PhotoStrip, photoBytes, type PhotoDraft } from "../field/components/media";
import { TYPE_CLASS } from "../field/lib";
import { cacheInfo, cachedInfo, enqueueReport, queued, removeReport, updateReport, type QueuedReport } from "./db";

const api = createApi("sw.qr.token");
const LANG_CHOSEN = "sw.qr.langChosen";

function route(): { kind: "form"; token: string } | { kind: "status"; caseNo: string; s: string } | { kind: "none" } {
  const p = location.pathname;
  const st = p.match(/^\/q\/status\/([^/]+)/);
  if (st) return { kind: "status", caseNo: decodeURIComponent(st[1]), s: new URLSearchParams(location.search).get("s") ?? "" };
  const f = p.match(/^\/q\/([^/]+)/);
  if (f) return { kind: "form", token: decodeURIComponent(f[1]) };
  return { kind: "none" };
}

export function QrApp() {
  const { t, lang, setLang } = useI18n();
  const r = useMemo(route, []);
  const [chosen, setChosen] = useState(() => !!safeGet(LANG_CHOSEN));
  if (!chosen) {
    return (
      <div className="login-wrap">
        <Card className="login-card">
          <div className="login-brand"><span className="mark">SW</span><div><h1 style={{ fontSize: 22, margin: 0 }}>{t("qr.chooseLanguage")}</h1><div className="small muted">{t("qr.chooseLanguageSub")}</div></div></div>
          <div className="lang-grid">
            {LANGS.map((l) => <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => { setLang(l); try { localStorage.setItem(LANG_CHOSEN, "1"); } catch { /* ok */ } setChosen(true); }} data-testid={`lang-${l}`}>{LANG_NAMES[l]}</button>)}
          </div>
        </Card>
      </div>
    );
  }
  if (r.kind === "status") return <StatusPage caseNo={r.caseNo} s={r.s} />;
  if (r.kind === "form") return <FormPage token={r.token} />;
  return <div className="login-wrap"><Card className="login-card"><h1 style={{ fontSize: 22 }}>{t("app.name")}</h1><p>{t("qr.noToken")}</p></Card></div>;
}

function Header({ title, sub }: { title: string; sub?: string }) {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <header className="topbar">
      <div className="brand grow"><span className="mark">SW</span><div style={{ minWidth: 0 }}><h1 className="truncate">{title}</h1>{sub ? <div className="sub truncate">{sub}</div> : null}</div></div>
      <div style={{ position: "relative" }}>
        <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-label={t("common.language")} aria-expanded={open}><IconLanguage size={18} /> <span lang={lang}>{LANG_NAMES[lang]}</span></Button>
        {open ? (
          <div className="card" style={{ position: "absolute", right: 0, top: "100%", zIndex: 50, minWidth: 160, padding: 6, color: "var(--ink)" }} role="menu">
            {LANGS.map((l) => <button key={l} type="button" role="menuitem" lang={l} className="btn ghost block" style={{ justifyContent: "flex-start" }} aria-pressed={lang === l} onClick={() => { setLang(l); setOpen(false); }}>{LANG_NAMES[l]}</button>)}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- the form */
function FormPage({ token }: { token: string }) {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [info, setInfo] = useState<QrInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [done, setDone] = useState<QueuedReport | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await cachedInfo(token);
      if (cached && !cancelled) setInfo(cached);
      try {
        const fresh = await api.get<QrInfo>(`/public/qr/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setInfo(fresh); setError(null); void cacheInfo(token, fresh);
      } catch (e) { if (!cancelled && !cached) setError(e); }
    })();
    return () => { cancelled = true; };
  }, [token, n]);

  // flush the queue whenever we are online
  const flush = useCallback(async () => {
    const items = await queued(token);
    setPendingCount(items.filter((i) => !i.caseNo).length);
    if (!navigator.onLine) return;
    for (const item of items) {
      try {
        let caseNo = item.caseNo, statusUrl = item.statusUrl, uploads: { clientUuid: string; url: string }[] = [];
        if (!caseNo) {
          const res = await api.post<QrObservationResponse>(`/public/qr/${encodeURIComponent(token)}/observations`, item.payload);
          caseNo = res.caseNo; statusUrl = res.statusUrl; uploads = res.uploads;
          await updateReport(item.clientUuid, { caseNo, statusUrl, lastError: null });
          (item as QueuedReport & { uploads?: typeof uploads }).uploads = uploads;
        }
        const uploaded = [...item.uploaded];
        for (const b of item.blobs) {
          if (uploaded.includes(b.ref.clientUuid)) continue;
          const u = uploads.find((x) => x.clientUuid === b.ref.clientUuid)?.url;
          if (!u) continue;
          await api.putBytes(u, b.blob, b.ref.mime);
          uploaded.push(b.ref.clientUuid);
          await updateReport(item.clientUuid, { uploaded });
        }
        if (uploaded.length >= item.blobs.length || !uploads.length) await removeReport(item.clientUuid);
        setDone((d) => (d && d.clientUuid === item.clientUuid ? { ...d, caseNo, statusUrl, uploaded } : d));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await updateReport(item.clientUuid, { attempts: item.attempts + 1, lastError: msg });
        setDone((d) => (d && d.clientUuid === item.clientUuid ? { ...d, lastError: msg, attempts: item.attempts + 1 } : d));
        if (e instanceof ApiError && !e.isNetwork && e.status < 500) { await removeReport(item.clientUuid); }
        break;
      }
    }
    setPendingCount((await queued(token)).filter((i) => !i.caseNo).length);
  }, [token]);
  useEffect(() => { void flush(); const id = setInterval(() => { if (navigator.onLine) void flush(); }, 30_000); window.addEventListener("online", flush); return () => { clearInterval(id); window.removeEventListener("online", flush); }; }, [flush]);

  if (error && !info) return <div className="page" style={{ paddingTop: 40 }}><ErrorCard error={error instanceof ApiError && error.status === 404 ? new Error(t("qr.badToken")) : error} onRetry={() => setN((x) => x + 1)} /></div>;
  if (!info) return <><Header title={t("qr.title")} /><div className="page"><Skeleton lines={8} /></div></>;
  const sub = `${info.site.code} · ${pick(info.site.name)}${info.area ? ` · ${pick(info.area.name)}` : ""}${info.asset ? ` · ${info.asset.tagNo}` : ""}`;
  if (done) return <><Header title={t("qr.title")} sub={sub} /><Done r={done} info={info} online={online} onAnother={() => setDone(null)} /></>;
  return (
    <>
      <Header title={t("qr.title")} sub={sub} />
      <div className="page" style={{ maxWidth: 640 }}>
        {!online ? <div className="banner offline" style={{ marginBottom: 10 }}><IconWifiOff size={16} /><span>{t("qr.offline")}</span></div> : null}
        {pendingCount ? <div className="banner info" style={{ marginBottom: 10 }}><span>{t("qr.queued", { count: pendingCount })}</span></div> : null}
        <ReportForm info={info} token={token} lang={lang} onSubmitted={(r) => { setDone(r); void flush(); }} toastErr={(m) => toast.error(m)} />
      </div>
    </>
  );
}

function ReportForm({ info, token, lang, onSubmitted, toastErr }: { info: QrInfo; token: string; lang: Lang; onSubmitted: (r: QueuedReport) => void; toastErr: (m: string) => void }) {
  const { t, pick } = useI18n();
  const geo = useGeo(true);
  const [type, setType] = useState<ObservationType | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [desc, setDesc] = useState("");
  const [fixed, setFixed] = useState(false);
  const [immediate, setImmediate] = useState("");
  const [danger, setDanger] = useState(false);
  const [anon, setAnon] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [employer, setEmployer] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [capturedAt] = useState(() => new Date().toISOString());
  const [showNotice, setShowNotice] = useState(false);
  const dirty = !!type || photos.length > 0 || !!desc;
  useBeforeUnload(dirty);
  const all = info.categories.filter((c) => c.active && (!type || !c.appliesTo.types?.length || c.appliesTo.types.includes(type))).sort((a, b) => a.sort - b.sort);
  const visible = more ? all : [...all.slice(0, 6), ...all.slice(6).filter((c) => cats.includes(c.code))];
  const chooseType = (ty: ObservationType) => { setType(ty); const allowed = info.categories.filter((c) => c.active && (!c.appliesTo.types?.length || c.appliesTo.types.includes(ty))).sort((a, b) => a.sort - b.sort); setCats((cc) => { const kept = cc.filter((c) => allowed.some((a) => a.code === c)); return kept.length ? kept : allowed[0] ? [allowed[0].code] : []; }); };
  const canSubmit = !!type && cats.length > 0 && (photos.length > 0 || desc.trim().length > 0);
  const maxPhotos = Math.min(3, info.maxPhotos || 3);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!type) e.type = t("report.needType");
    if (cats.length === 0) e.cats = t("report.needCategory");
    if (photos.length === 0 && !desc.trim()) e.desc = t("report.needPhotoOrText");
    if (fixed && !immediate.trim()) e.immediate = t("report.needWhatYouDid");
    if (!anon && phone && !/^[+\d][\d\s-]{6,}$/.test(phone)) e.phone = t("qr.badPhone");
    setErrs(e);
    if (Object.keys(e).length) { toastErr(t("error.validation")); return; }
    setBusy(true);
    try {
      const payload: QrObservationCreate = {
        clientUuid: uuid(), type: type!, categoryCodes: cats, description: desc.trim(), descriptionLang: lang, fixedOnSpot: fixed, immediateAction: fixed ? immediate.trim() : undefined, imminentDanger: danger,
        anonymous: anon, name: anon ? undefined : name.trim() || undefined, phone: anon ? undefined : phone.trim() || undefined, reporterType: anon ? "visitor" : employer ? "contractor" : "employee", employerName: anon ? undefined : employer.trim() || undefined,
        lat: geo.lat, lng: geo.lng, accuracyM: geo.accuracyM, capturedAt, media: photos.map((p) => p.ref), honeypot: hp || undefined,
      };
      const item: QueuedReport = { clientUuid: payload.clientUuid, token, payload, blobs: photos.map(photoBytes), createdAt: new Date().toISOString(), attempts: 0, lastError: null, caseNo: null, statusUrl: null, uploaded: [] };
      await enqueueReport(item);
      onSubmitted(item);
    } catch (e) { toastErr(errorKey(e).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="loc-chip" style={{ cursor: "default" }} aria-label={t("common.area")}>
        <IconMapPin />
        <span className="txt"><b>{info.site.code} · {pick(info.site.name)}</b><small>{info.area ? pick(info.area.name) : info.asset ? info.asset.tagNo : t("qr.wholeSite")}</small></span>
      </div>
      <div className="locked" style={{ margin: "8px 0 14px" }}>
        <Pill>{fmtDateTime(capturedAt, lang)}</Pill>
        <Pill tone={geo.state === "ok" ? "green" : "grey"}>{geo.state === "ok" ? `${t("common.gps")} ${t("common.gpsAcc", { m: geo.accuracyM })}` : geo.state === "locating" ? t("report.locating") : t("common.gpsNone")}</Pill>
      </div>
      <div className="label" style={{ marginBottom: 6 }}>{t("report.type")}<span className="req" aria-hidden>*</span></div>
      <div className="type-grid" role="group" aria-label={t("report.type")}>
        {([["good_practice", <IconThumbUp key="g" />], ["unsafe_act", <IconHand key="a" />], ["unsafe_condition", <IconHazard key="c" />], ["near_miss", <IconNearMiss key="n" />]] as [ObservationType, JSX.Element][]).map(([ty, icon]) => (
          <button key={ty} type="button" className={`type-btn ${TYPE_CLASS[ty]}`} aria-pressed={type === ty} onClick={() => chooseType(ty)} data-testid={`type-${ty}`}><span className="ico">{icon}</span><span>{t(`type.${ty}`)}</span></button>
        ))}
      </div>
      {errs.type ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }}>{errs.type}</div> : null}
      <div className="label" style={{ margin: "14px 0 6px" }}>{t("common.categories")}<span className="req" aria-hidden>*</span></div>
      <div className="cat-chips" role="group">
        {visible.map((c) => <Chip key={c.code} size="lg" on={cats.includes(c.code)} onClick={() => setCats((cc) => (cc.includes(c.code) ? cc.filter((x) => x !== c.code) : [...cc, c.code]))} data-testid={`cat-${c.code}`}>{pick(c.name)}</Chip>)}
        {all.length > 6 ? <Chip size="lg" onClick={() => setMore((m) => !m)}>{more ? t("common.less") : t("common.more")} ›</Chip> : null}
      </div>
      {errs.cats ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }}>{errs.cats}</div> : null}
      <div style={{ marginTop: 14 }}><PhotoStrip photos={photos} onChange={setPhotos} max={maxPhotos} purpose="before" geo={geo} big label={t("report.photos")} /></div>
      <div style={{ marginTop: 14 }}>
        <Field label={t("report.describe")} hint={t("report.describeHint")} error={errs.desc}>
          <Textarea rows={2} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("report.describePlaceholder")} data-testid="description" />
        </Field>
      </div>
      <Toggle label={t("report.fixedOnSpot")} hint={t("report.fixedHint")} checked={fixed} onChange={setFixed} />
      {fixed ? <Field label={t("report.whatDidYouDo")} required error={errs.immediate}><Textarea rows={2} maxLength={300} value={immediate} onChange={(e) => setImmediate(e.target.value)} /></Field> : null}
      <div className={danger ? "danger-toggle" : undefined}><Toggle danger label={<span className="row" style={{ gap: 6 }}><IconStop size={18} /> {t("report.dangerNow")}</span>} hint={t("report.dangerHint")} checked={danger} onChange={setDanger} /></div>
      <Toggle label={<span className="row" style={{ gap: 6 }}><IconEyeOff size={18} /> {t("report.anonymous")}</span>} hint={t("qr.anonymousHint")} checked={anon} onChange={setAnon} />
      {!anon ? (
        <div className="card flat" style={{ marginBottom: 10 }}>
          <Field label={t("qr.name")} optional><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} /></Field>
          <Field label={t("qr.phone")} optional error={errs.phone} hint={t("qr.phoneHint")}><Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} /></Field>
          <Field label={t("common.employer")} optional><Input value={employer} onChange={(e) => setEmployer(e.target.value)} maxLength={80} /></Field>
        </div>
      ) : null}
      {/* honeypot: real people never see or fill this */}
      <div style={{ position: "absolute", left: -9999, top: -9999, height: 0, overflow: "hidden" }} aria-hidden>
        <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>{t("qr.privacyLine", { org: info.orgName })} <button type="button" className="btn ghost sm" onClick={() => setShowNotice((s) => !s)}>{t("privacy.title")}</button></p>
      {showNotice ? <div className="hint-box" style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{info.privacyNotice?.[lang] ?? info.privacyNotice?.en ?? ""}</div> : null}
      <div className="submit-bar" style={{ bottom: 0 }}>
        <Button variant="primary" block size="lg" disabled={!canSubmit} loading={busy} onClick={submit} data-testid="submit">{t("report.submit")}</Button>
        {!canSubmit ? <p className="small muted" style={{ textAlign: "center", margin: "6px 0 0" }}>{t("report.submitHint")}</p> : null}
      </div>
    </div>
  );
}

function Done({ r, info, online, onAnother }: { r: QueuedReport; info: QrInfo; online: boolean; onAnother: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const statusLink = r.statusUrl ? (r.statusUrl.startsWith("http") ? r.statusUrl : `${location.origin}${r.statusUrl}`) : "";
  const up = r.uploaded.length, total = r.blobs.length;
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="success-screen" data-testid="submitted">
        <SuccessMark />
        <h1 style={{ fontSize: 24 }}>{r.caseNo ? t("report.savedTitle") : t("qr.savedOnPhone")}</h1>
        <div className={`case${r.caseNo ? "" : " pending"}`} data-testid="case-no">{r.caseNo || t("common.pendingNumber")}</div>
        {!r.caseNo ? <p className="muted">{online ? t("qr.sending") : t("qr.willSend")}</p> : <p className="muted">{t("report.willTell")}</p>}
        {r.lastError && !r.caseNo ? <div className="banner warn"><span>{r.lastError}</span></div> : null}
        {total > 0 ? <div style={{ width: "100%", maxWidth: 320 }}><Progress value={up} max={total} /><div className="small muted" style={{ marginTop: 4 }}>{up >= total ? t("qr.photosDone", { count: total }) : t("sync.photosUploading", { done: up, total })}</div></div> : null}
        {statusLink ? (
          <div className="card flat" style={{ width: "100%", textAlign: "left" }}>
            <div className="small muted">{t("qr.statusLink")}</div>
            <div className="row nowrap"><a href={statusLink} className="truncate grow" style={{ fontSize: 14 }}>{statusLink}</a><Button size="sm" icon aria-label={t("common.copy")} onClick={async () => { if (await copyText(statusLink)) toast.success(t("common.copied")); }} data-testid="copy-link"><IconCopy size={16} /></Button></div>
            <p className="small muted" style={{ margin: "6px 0 0" }}>{t("qr.statusHint")}</p>
          </div>
        ) : null}
        <Button variant="primary" size="lg" onClick={onAnother}><IconCheck size={18} /> {t("report.another")}</Button>
        <p className="small muted">{info.orgName}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- status page */
function StatusPage({ caseNo, s }: { caseNo: string; s: string }) {
  const { t, lang } = useI18n();
  const [st, setSt] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.get<PublicStatus>(`/public/status/${encodeURIComponent(caseNo)}`, { s }).then((x) => { if (!cancelled) setSt(x); }, (e) => { if (!cancelled) setError(e); });
    return () => { cancelled = true; };
  }, [caseNo, s, n]);
  return (
    <>
      <Header title={t("qr.statusTitle")} sub={caseNo} />
      <div className="page" style={{ maxWidth: 640 }}>
        {error ? <ErrorCard error={error instanceof ApiError && (error.status === 404 || error.status === 403) ? new Error(t("qr.statusNotFound")) : error} onRetry={() => setN((x) => x + 1)} /> : !st ? <Skeleton lines={6} /> : (
          <Card>
            <div className="row between"><h2 style={{ fontSize: 20, margin: 0 }} className="mono">{st.caseNo}</h2><Pill tone={st.status === "closed" ? "green" : st.status === "action_assigned" ? "blue" : st.status === "discarded" ? "grey" : "hivis"}>{t(`obs.status.${st.status}`)}</Pill></div>
            <p className="small muted">{t(`type.${st.type}`)} · {t("qr.receivedAt", { time: fmtDateTime(st.receivedAt, lang) })}</p>
            <Timeline items={st.timeline.slice().reverse().map((e, i) => ({ key: i, tone: i === 0 ? "blue" : "grey", who: relative(e.at, t, lang), when: fmtDateTime(e.at, lang), text: e.text }))} />
            {st.closureSummary ? <div className="banner synced"><span><b>{t("obs.closureSummary")}:</b> {st.closureSummary}</span></div> : null}
            <p className="small muted" style={{ marginTop: 10 }}>{t("qr.statusPrivacy")}</p>
          </Card>
        )}
      </div>
    </>
  );
}

