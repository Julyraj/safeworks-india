/* Action detail: owner (Start, Request new date, Dispute, Complete with after-photo), verifier (before/after side by
   side, method, Effective / Not effective with reason), officer (decide requests, reassign, cancel with site-head
   approval). Owner and verifier steps are sync commands; officer decisions use the REST routes and need a connection. */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ActionDetail as Detail, ActionRequestDecide, VerificationMethod } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Card, CardHead, Confirm, ErrorCard, Field, Input, Lightbox, Pill, BandPill, Select, Sheet, Skeleton, Textarea, Timeline, useToast, Thumb } from "../../shared/ui";
import { useBeforeUnload } from "../../shared/hooks";
import { IconPlay, IconCalendar, IconFlag, IconCheck, IconSend, IconSwap, IconX, IconAlert } from "../../shared/icons";
import { fmtDateTime, dueText, relative } from "../../shared/format";
import { dueFromRule, ruleFor } from "../../shared/risk";
import { uuid } from "../../shared/storage";
import { errorKey } from "../../shared/api";
import { api } from "../api";
import { useSession, isOfficer, isVerifier, isSiteHead } from "../session";
import { useActions, useDetail, useLocalMediaPreviews, useMediaMeta, useOutbox, useRefData } from "../offline/store";
import { completeAction, requestOnAction, startAction, verifyAction, commentAction } from "../offline/commands";
import { PendingMarkers, SubHead, ActionStatusChip, UserSelect, useOnlineOnly, useNow } from "../components/common";
import { PhotoStrip, photoBytes, type PhotoDraft } from "../components/media";
import { toLocalInput, fromLocalInput } from "../components/triage";
import { assignable, siteHeads, userName } from "../lib";

const METHODS: VerificationMethod[] = ["re_inspection", "observation_sampling", "recurrence_check", "audit"];
const DATE_REASONS = ["parts_awaited", "contractor_availability", "permit_pending", "weather", "scope_change", "other"];
const DISPUTE_REASONS = ["not_our_scope", "needs_other_trade", "already_done", "wrong_owner", "other"];
type SheetKind = null | "complete" | "verify" | "date" | "dispute" | "reassign" | "cancel" | { decide: string };

export default function ActionDetail() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const ref = useRefData();
  const { data: actions } = useActions();
  const local = actions.find((a) => a.id === id || a.clientUuid === id) ?? null;
  const { data: detail, loading, error, reload, update, stale } = useDetail<Detail>("action", local?.local ? null : id, () => api.get<Detail>(`/actions/${id}`));
  const a = detail ?? local;
  const { online } = useOnlineOnly();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [view, setView] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  useNow(60_000);
  const mediaMeta = useMediaMeta();
  const { data: outbox } = useOutbox();
  const localAfter = useMemo(() => {
    const cmds = new Set(outbox.filter((x) => x.entityType === "action" && x.op === "complete" && (x.targetId === id || x.targetId === local?.id)).map((x) => x.commandId));
    return mediaMeta.filter((m) => m.ref.purpose === "after" && cmds.has(m.commandId));
  }, [mediaMeta, outbox, id, local?.id]);
  const previews = useLocalMediaPreviews(localAfter.map((m) => m.clientUuid));

  if (!a && loading) return <div className="page"><SubHead title={t("action.title")} /><Skeleton lines={8} /></div>;
  if (!a) return <div className="page"><SubHead title={t("action.title")} /><ErrorCard error={error ?? new Error(t("error.notFound"))} onRetry={reload} /></div>;

  const isOwner = a.ownerUserId === me?.id;
  const officer = isOfficer(me, a.siteId);
  const open = ["open", "in_progress", "reopened", "disputed"].includes(a.status);
  const due = dueText(a.dueAt, open, t);
  const can = detail?.can ?? {
    start: isOwner && (a.status === "open" || a.status === "reopened"), complete: isOwner && ["open", "in_progress", "reopened"].includes(a.status),
    verify: a.status === "completed" && !isOwner && isVerifier(me, a.siteId), request: isOwner && open && !a.pendingRequest, decide: officer && !!a.pendingRequest,
    cancel: officer && open, reassign: officer && open, comment: true,
  };
  const area = ref.areas.find((x) => x.id === a.areaId);
  const before = detail?.sourceMedia.filter((m) => m.kind === "photo") ?? [];
  const after = detail?.events.flatMap((e) => e.media.filter((m) => m.purpose === "after")) ?? [];
  const pendingReq = detail?.requests.find((r) => r.status === "pending");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setSheet(null); } catch (e) { const { key, message } = errorKey(e); toast.error(key === "error.generic" ? message : t(key)); } finally { setBusy(false); }
  };
  const rest = async (path: string, body: unknown) => { const d = await api.post<Detail>(path, body); update(d); };

  const timeline = (detail?.events ?? []).slice().sort((x, y) => y.at.localeCompare(x.at)).map((e) => ({
    key: e.id, tone: (e.eventType === "verification" ? (e.toStatus === "verified" ? "green" : "red") : e.eventType === "status_change" ? "blue" : e.eventType === "escalated" || e.eventType === "dispute_raised" ? "red" : e.eventType === "reminder_sent" ? "grey" : "hivis") as "green" | "red" | "blue" | "grey" | "hivis",
    who: e.actorName ?? t("common.system"), when: relative(e.at, t, lang),
    text: <>{t(`action.event.${e.eventType}`)}{e.toStatus ? <> → {t(`action.status.${e.toStatus}`)}</> : null}{e.body ? <div className="small">{e.body}</div> : null}</>,
    extra: e.media.length ? <div className="row" style={{ marginTop: 4 }}>{e.media.map((m) => <Thumb key={m.id} media={m} src={m.url ? api.file(m.url) : undefined} onClick={() => m.url && setView(api.file(m.url))} tag={m.purpose === "after" ? t("action.after") : undefined} />)}</div> : undefined,
  }));

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <SubHead title={a.caseNo || t("common.pendingNumber")} kicker={<span className="row" style={{ gap: 6 }}><ActionStatusChip status={a.status} overdue={a.overdue} /><BandPill band={a.band} />{a.pendingRequest ? <Pill tone="amber">{t(`action.request.${a.pendingRequest}`)}</Pill> : null}</span>} />
      <PendingMarkers targetId={a.id} />
      {stale && !online ? <div className="stale">{t("common.offlineCopy")}</div> : null}

      <Card>
        <h2 style={{ fontSize: 20 }}>{a.title}</h2>
        <div className="due-big"><span className={`v${due.late ? " late" : ""}`}>{due.text}</span><span className="small muted">{fmtDateTime(a.dueAt, lang)}{a.originalDueAt !== a.dueAt ? ` · ${t("action.originalDue", { date: fmtDateTime(a.originalDueAt, lang) })}` : ""}</span></div>
        {detail?.problem ? <p style={{ marginTop: 8 }}>{detail.problem}</p> : null}
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>{t("common.owner")}</dt><dd>{isOwner ? t("common.you") : a.ownerName}</dd>
          {a.sourceCaseNo ? <><dt>{t("action.source")}</dt><dd>{a.sourceType === "observation" && a.sourceId ? <button type="button" className="btn ghost sm" onClick={() => nav(`/o/${a.sourceId}`)}>{a.sourceCaseNo}</button> : a.sourceType === "inspection_answer" && a.sourceId ? <button type="button" className="btn ghost sm" onClick={() => nav(`/inspections/runs/${a.sourceId}`)}>{a.sourceCaseNo}</button> : a.sourceCaseNo}</dd></> : null}
          {area ? <><dt>{t("common.area")}</dt><dd>{area.name.en}</dd></> : null}
          {detail ? <><dt>{t("action.type")}</dt><dd>{t(`action.type.${detail.actionType}`)} · {t(`control.${detail.controlLevel}`)}</dd></> : null}
          {detail?.interimControl ? <><dt>{t("action.interim")}</dt><dd>{detail.interimControl}{detail.interimReviewAt ? <span className="small muted"> · {t("action.interimReview", { time: fmtDateTime(detail.interimReviewAt, lang) })}</span> : null}</dd></> : null}
          {detail?.statutoryClock ? <><dt>{t("action.statutory")}</dt><dd>{detail.statutoryClock}</dd></> : null}
          {a.reopenCount ? <><dt>{t("action.reopenedLabel")}</dt><dd>{a.reopenCount}×{detail?.verificationReason ? ` — ${detail.verificationReason}` : ""}</dd></> : null}
          {detail?.completionNote ? <><dt>{t("action.completionNote")}</dt><dd>{detail.completionNote}<div className="small muted">{t("action.causeAddressed")}: {detail.causeAddressed}</div></dd></> : null}
          {detail?.verificationResult ? <><dt>{t("action.verification")}</dt><dd>{t(`action.result.${detail.verificationResult}`)} · {t(`verify.${detail.verificationMethod}`)} · {detail.verifierName}</dd></> : null}
          {detail?.cancelReason ? <><dt>{t("action.cancelled")}</dt><dd>{detail.cancelReason}</dd></> : null}
        </dl>
      </Card>

      {(before.length || after.length || localAfter.length) ? (
        <Card style={{ marginTop: 12 }}>
          <CardHead title={t("action.evidence")} />
          <div className="compare">
            <figure>
              <figcaption>{t("action.before")}</figcaption>
              {before[0] ? <img src={api.file(before[0].url)} alt={t("action.before")} onClick={() => before[0].url && setView(api.file(before[0].url))} style={{ cursor: "zoom-in" }} /> : <div className="skeleton" style={{ aspectRatio: "4/3", borderRadius: 10 }} />}
            </figure>
            <figure>
              <figcaption>{t("action.after")}</figcaption>
              {after[0] ? <img src={api.file(after[0].url)} alt={t("action.after")} onClick={() => after[0].url && setView(api.file(after[0].url))} style={{ cursor: "zoom-in" }} /> : localAfter[0] && previews[localAfter[0].clientUuid] ? <img src={previews[localAfter[0].clientUuid]} alt={t("action.after")} style={{ opacity: 0.85 }} /> : <div className="skeleton" style={{ aspectRatio: "4/3", borderRadius: 10 }} />}
            </figure>
          </div>
          {(before.length + after.length) > 2 ? (
            <div className="evidence-grid" style={{ marginTop: 8 }}>
              {[...before.slice(1), ...after.slice(1)].map((m) => <img key={m.id} src={api.file(m.url)} alt="" onClick={() => m.url && setView(api.file(m.url))} />)}
            </div>
          ) : null}
        </Card>
      ) : null}

      {pendingReq ? (
        <Card style={{ marginTop: 12 }} className="dup">
          <CardHead title={t(`action.request.${pendingReq.type}`)} kicker={`${pendingReq.requestedByName} · ${relative(pendingReq.createdAt, t, lang)}`} />
          <p>{t(`action.reason.${pendingReq.reasonCode}`)} — {pendingReq.reason}{pendingReq.proposedDueAt ? <><br /><b>{t("action.proposedDue")}:</b> {fmtDateTime(pendingReq.proposedDueAt, lang)}</> : null}</p>
          {can.decide ? <Button variant="primary" onClick={() => setSheet({ decide: pendingReq.id })} disabled={!online} title={online ? undefined : t("common.needsConnection")}>{t("action.decide")}</Button> : null}
        </Card>
      ) : null}

      <div className="btn-group" style={{ marginTop: 14 }}>
        {can.start ? <Button variant="primary" onClick={() => run(() => startAction(a.id, `${t("action.start")} · ${a.caseNo}`), t("action.started"))} loading={busy}><IconPlay size={18} /> {t("action.start")}</Button> : null}
        {can.complete ? <Button variant={can.start ? "default" : "primary"} onClick={() => setSheet("complete")} data-testid="complete-open"><IconCheck size={18} /> {t("action.complete")}</Button> : null}
        {can.verify ? <Button variant="primary" onClick={() => setSheet("verify")} data-testid="verify-open"><IconCheck size={18} /> {t("action.verify")}</Button> : null}
        {can.request ? <Button onClick={() => setSheet("date")}><IconCalendar size={18} /> {t("action.requestDate")}</Button> : null}
        {can.request ? <Button onClick={() => setSheet("dispute")}><IconFlag size={18} /> {t("action.dispute")}</Button> : null}
        {can.reassign ? <Button onClick={() => setSheet("reassign")} disabled={!online} title={online ? undefined : t("common.needsConnection")}><IconSwap size={18} /> {t("action.reassign")}</Button> : null}
        {can.cancel ? <Button variant="ghost" onClick={() => setSheet("cancel")} disabled={!online} title={online ? undefined : t("common.needsConnection")}><IconX size={18} /> {t("action.cancel")}</Button> : null}
      </div>
      {a.status === "completed" && isOwner ? <p className="small muted" style={{ marginTop: 8 }}>{t("action.awaitingVerifier")}</p> : null}

      <section style={{ marginTop: 14 }}>
        <h3>{t("common.timeline")}</h3>
        {detail ? <Timeline items={timeline} /> : <p className="small muted">{online ? t("common.loading") : t("action.timelineOffline")}</p>}
        {can.comment ? (
          <div className="input-row" style={{ marginTop: 8 }}>
            <Textarea rows={1} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("obs.commentPlaceholder")} maxLength={500} style={{ minHeight: 48 }} />
            <Button variant="primary" disabled={comment.trim().length < 2} loading={busy} aria-label={t("common.add")} onClick={() => run(async () => { await commentAction(a.id, comment.trim(), [], `${t("common.comments")} · ${a.caseNo}`); setComment(""); }, t("obs.commentSaved"))}><IconSend size={18} /></Button>
          </div>
        ) : null}
      </section>

      {view ? <Lightbox src={view} onClose={() => setView(null)} /> : null}
      {sheet === "complete" ? <CompleteSheet onClose={() => setSheet(null)} busy={busy} onSubmit={(note, cause, photos) => run(() => completeAction(a.id, { clientUuid: uuid(), completionNote: note, causeAddressed: cause, media: photos.map((p) => p.ref), capturedAt: new Date().toISOString() }, photos.map(photoBytes), `${t("action.complete")} · ${a.caseNo}`), t("action.completedSaved"))} /> : null}
      {sheet === "verify" ? <VerifySheet beforeUrl={before[0]?.url ? api.file(before[0].url) : null} afterUrl={after[0]?.url ? api.file(after[0].url) : null} onClose={() => setSheet(null)} busy={busy} band={a.band} siteId={a.siteId} onSubmit={(result, method, reason, photos) => run(() => verifyAction(a.id, { clientUuid: uuid(), result, method, reason: reason || undefined, media: photos.length ? photos.map((p) => p.ref) : undefined, capturedAt: new Date().toISOString() }, photos.map(photoBytes), `${t("action.verify")} · ${a.caseNo}`), t("action.verifiedSaved"))} /> : null}
      {sheet === "date" || sheet === "dispute" ? <RequestSheet kind={sheet} dueAt={a.dueAt} thirdRequest={(detail?.requests.filter((r) => r.type === "date_change").length ?? 0) >= (me?.org.settings.dateChangeRequestsBeforeSiteHead ?? 3) - 1} onClose={() => setSheet(null)} busy={busy} onSubmit={(code, reason, proposed) => run(() => requestOnAction(a.id, { clientUuid: uuid(), type: sheet === "date" ? "date_change" : "dispute", proposedDueAt: proposed, reasonCode: code, reason, capturedAt: new Date().toISOString() }, `${t(sheet === "date" ? "action.requestDate" : "action.dispute")} · ${a.caseNo}`), t("action.requestSaved"))} /> : null}
      {sheet === "reassign" ? <ReassignSheet siteId={a.siteId} current={a.ownerUserId} onClose={() => setSheet(null)} busy={busy} onSubmit={(newOwnerUserId, reason) => run(() => rest(`/actions/${a.id}/reassign`, { newOwnerUserId, reason }), t("action.reassigned"))} /> : null}
      {sheet === "cancel" ? <CancelSheet siteId={a.siteId} onClose={() => setSheet(null)} busy={busy} onSubmit={(reason, approvedByUserId) => run(() => rest(`/actions/${a.id}/cancel`, { reason, approvedByUserId }), t("action.cancelledSaved"))} /> : null}
      {sheet && typeof sheet === "object" && pendingReq ? <DecideSheet req={pendingReq} siteId={a.siteId} onClose={() => setSheet(null)} busy={busy} onSubmit={(body) => run(() => rest(`/actions/${a.id}/requests/${pendingReq.id}/decide`, body), t("action.decided"))} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- sheets */
function CompleteSheet({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (note: string, cause: string, photos: PhotoDraft[]) => void; busy: boolean }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [cause, setCause] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useBeforeUnload(!!note || photos.length > 0);
  const submit = () => {
    const e: Record<string, string> = {};
    if (note.trim().length < 3) e.note = t("action.needNote");
    if (cause.trim().length < 3) e.cause = t("action.needCause");
    if (photos.length === 0) e.photos = t("action.needAfterPhoto");
    setErrs(e);
    if (Object.keys(e).length) return;
    onSubmit(note.trim(), cause.trim(), photos);
  };
  return (
    <Sheet title={t("action.complete")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" loading={busy} onClick={submit} data-testid="complete-submit">{t("action.markComplete")}</Button></>}>
      <PhotoStrip photos={photos} onChange={setPhotos} max={10} purpose="after" big label={t("action.afterPhoto")} required />
      {errs.photos ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 4 }} data-testid="after-photo-error">{errs.photos}</div> : null}
      <div style={{ height: 10 }} />
      <Field label={t("action.completionNote")} required error={errs.note}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus placeholder={t("action.completionHint")} /></Field>
      <Field label={t("action.causeAddressed")} required error={errs.cause} hint={t("action.causeHint")}><Textarea rows={2} value={cause} onChange={(e) => setCause(e.target.value)} maxLength={500} /></Field>
    </Sheet>
  );
}

function VerifySheet({ beforeUrl, afterUrl, band, siteId, onClose, onSubmit, busy }: { beforeUrl: string | null; afterUrl: string | null; band: Detail["band"]; siteId: string; onClose: () => void; onSubmit: (result: "effective" | "not_effective", method: VerificationMethod, reason: string, photos: PhotoDraft[]) => void; busy: boolean }) {
  const { t, lang } = useI18n();
  const ref = useRefData();
  const [method, setMethod] = useState<VerificationMethod>("re_inspection");
  const [result, setResult] = useState<"effective" | "not_effective" | null>(null);
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const site = ref.sites.find((s) => s.id === siteId);
  const newDue = dueFromRule(ruleFor(ref.dueDateRules, band, siteId), new Date(), site?.workingCalendar.weeklyOff);
  const submit = () => {
    if (!result) { setErr(t("action.needResult")); return; }
    if (result === "not_effective" && reason.trim().length < 3) { setErr(t("action.needReason")); return; }
    onSubmit(result, method, reason.trim(), photos);
  };
  return (
    <Sheet title={t("action.verify")} onClose={onClose} wide footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant={result === "not_effective" ? "danger" : "primary"} loading={busy} onClick={submit} data-testid="verify-submit">{result === "not_effective" ? t("action.result.not_effective") : t("action.result.effective")}</Button></>}>
      <div className="compare">
        <figure><figcaption>{t("action.before")}</figcaption>{beforeUrl ? <img src={beforeUrl} alt={t("action.before")} /> : <div className="skeleton" style={{ aspectRatio: "4/3", borderRadius: 10 }} />}</figure>
        <figure><figcaption>{t("action.after")}</figcaption>{afterUrl ? <img src={afterUrl} alt={t("action.after")} /> : <div className="skeleton" style={{ aspectRatio: "4/3", borderRadius: 10 }} />}</figure>
      </div>
      <Field label={t("action.method")} required>
        <Select value={method} onChange={(e) => setMethod(e.target.value as VerificationMethod)}>{METHODS.map((m) => <option key={m} value={m}>{t(`verify.${m}`)}</option>)}</Select>
      </Field>
      <div className="pfn" role="group" aria-label={t("action.result")}>
        <button type="button" className="green" aria-pressed={result === "effective"} onClick={() => setResult("effective")} data-testid="result-effective">{t("action.result.effective")}</button>
        <button type="button" className="red" aria-pressed={result === "not_effective"} onClick={() => setResult("not_effective")} data-testid="result-not-effective">{t("action.result.not_effective")}</button>
      </div>
      {result === "not_effective" ? (
        <div style={{ marginTop: 10 }}>
          <div className="banner warn" style={{ marginBottom: 8 }}><IconAlert size={16} /><span>{t("action.reopenHint", { date: fmtDateTime(newDue.toISOString(), lang) })}</span></div>
          <Field label={t("common.reason")} required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus /></Field>
        </div>
      ) : null}
      {err ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 6 }}>{err}</div> : null}
      <div style={{ marginTop: 12 }}><PhotoStrip photos={photos} onChange={setPhotos} max={5} purpose="evidence" label={t("action.verifyPhoto")} /></div>
    </Sheet>
  );
}

function RequestSheet({ kind, dueAt, thirdRequest, onClose, onSubmit, busy }: { kind: "date" | "dispute"; dueAt: string; thirdRequest: boolean; onClose: () => void; onSubmit: (code: string, reason: string, proposed?: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [proposed, setProposed] = useState(toLocalInput(new Date(new Date(dueAt).getTime() + 7 * 86_400_000).toISOString()));
  const [err, setErr] = useState<string | null>(null);
  const codes = kind === "date" ? DATE_REASONS : DISPUTE_REASONS;
  const submit = () => {
    if (!code) { setErr(t("action.needReasonCode")); return; }
    if (reason.trim().length < 3) { setErr(t("action.needReason")); return; }
    if (kind === "date" && (!proposed || new Date(proposed).getTime() <= Date.now())) { setErr(t("action.needFutureDate")); return; }
    onSubmit(code, reason.trim(), kind === "date" ? fromLocalInput(proposed) : undefined);
  };
  return (
    <Sheet title={kind === "date" ? t("action.requestDate") : t("action.dispute")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" loading={busy} onClick={submit}>{t("action.sendRequest")}</Button></>}>
      {kind === "date" && thirdRequest ? <div className="banner warn" style={{ marginBottom: 10 }}><IconAlert size={16} /><span>{t("action.thirdRequest")}</span></div> : null}
      {kind === "dispute" ? <p className="small muted">{t("action.disputeHint")}</p> : null}
      <Field label={t("triage.reasonCode")} required>
        <Select value={code} onChange={(e) => setCode(e.target.value)}><option value="">{t("common.choose")}</option>{codes.map((c) => <option key={c} value={c}>{t(`action.reason.${c}`)}</option>)}</Select>
      </Field>
      {kind === "date" ? <Field label={t("action.proposedDue")} required><Input type="datetime-local" value={proposed} onChange={(e) => setProposed(e.target.value)} /></Field> : null}
      <Field label={t("common.reason")} required error={err}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
    </Sheet>
  );
}

function ReassignSheet({ siteId, current, onClose, onSubmit, busy }: { siteId: string; current: string; onClose: () => void; onSubmit: (newOwner: string, reason: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const { me } = useSession();
  const ref = useRefData();
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const users = assignable(ref, siteId).filter((u) => u.id !== current);
  return (
    <Sheet title={t("action.reassign")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" loading={busy} disabled={!owner || reason.trim().length < 3} onClick={() => onSubmit(owner, reason.trim())}>{t("action.reassign")}</Button></>}>
      <Field label={t("action.newOwner")} required><UserSelect users={users} value={owner} onChange={setOwner} allowEmpty meId={me?.id} /></Field>
      <Field label={t("common.reason")} required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
    </Sheet>
  );
}

function CancelSheet({ siteId, onClose, onSubmit, busy }: { siteId: string; onClose: () => void; onSubmit: (reason: string, approvedBy: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const { me } = useSession();
  const ref = useRefData();
  const heads = siteHeads(ref, siteId);
  const [approver, setApprover] = useState(isSiteHead(me, siteId) && me ? me.id : heads[0]?.id ?? "");
  if (!approver && !heads.length) return <Sheet title={t("action.cancel")} onClose={onClose}><p>{t("action.noSiteHead")}</p></Sheet>;
  return (
    <Confirm title={t("action.cancel")} confirmLabel={t("action.cancel")} danger reasonRequired reasonLabel={t("common.reason")} onClose={onClose}
      body={<span>{t("action.cancelHint")}<br /><Field label={t("action.approvedBy")} required><UserSelect users={isSiteHead(me, siteId) && me ? [{ id: me.id, name: me.name }, ...heads.filter((h) => h.id !== me.id)] : heads} value={approver} onChange={setApprover} /></Field></span>}
      onConfirm={(reason) => { if (!busy) onSubmit(reason, approver); }} />
  );
}

function DecideSheet({ req, siteId, onClose, onSubmit, busy }: { req: Detail["requests"][number]; siteId: string; onClose: () => void; onSubmit: (b: ActionRequestDecide) => void; busy: boolean }) {
  const { t } = useI18n();
  const { me } = useSession();
  const ref = useRefData();
  const [decision, setDecision] = useState<ActionRequestDecide["decision"]>("approved");
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState("");
  const [newDue, setNewDue] = useState(toLocalInput(req.proposedDueAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString()));
  const users = assignable(ref, siteId);
  return (
    <Sheet title={t("action.decide")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" loading={busy} disabled={decision === "reassigned" && !owner} onClick={() => onSubmit({ decision, note: note.trim() || undefined, newOwnerUserId: decision === "reassigned" ? owner : undefined, newDueAt: decision === "approved" && req.type === "date_change" ? fromLocalInput(newDue) : undefined })}>{t(`action.decision.${decision}`)}</Button></>}>
      <p className="small muted">{req.requestedByName}: {t(`action.reason.${req.reasonCode}`)} — {req.reason}</p>
      <div className="decision-grid">
        {(["approved", "rejected", "reassigned"] as const).map((d) => <button key={d} type="button" className={`decision-btn${d === "rejected" ? " danger" : ""}`} aria-pressed={decision === d} onClick={() => setDecision(d)}>{t(`action.decision.${d}`)}</button>)}
      </div>
      {decision === "approved" && req.type === "date_change" ? <Field label={t("action.newDue")} required><Input type="datetime-local" value={newDue} onChange={(e) => setNewDue(e.target.value)} /></Field> : null}
      {decision === "reassigned" ? <Field label={t("action.newOwner")} required><UserSelect users={users} value={owner} onChange={setOwner} allowEmpty meId={me?.id} /></Field> : null}
      <Field label={t("common.note")} optional><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      <p className="small muted">{userName(ref, me?.id, me, t)} · {t("action.decideHint")}</p>
    </Sheet>
  );
}
