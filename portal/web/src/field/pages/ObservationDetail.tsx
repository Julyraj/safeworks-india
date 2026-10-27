/* Observation detail: photos (server or still-on-the-phone), locked facts, triage timeline and comments, linked actions,
   duplicates for officers, reply when returned, comment, "Ack critical", and the triage sheet for officers. */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { DuplicateSuggestion, ObservationDetail as Detail } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Card, CardHead, ErrorCard, Field, Lightbox, Pill, BandPill, Skeleton, Textarea, Timeline, useToast, Thumb } from "../../shared/ui";
import { IconAlert, IconMapPin, IconClock, IconUser, IconMerge, IconSend } from "../../shared/icons";
import { fmtDateTime, relative } from "../../shared/format";
import { api } from "../api";
import { useSession, isOfficer } from "../session";
import { useDetail, useLocalMediaPreviews, useMediaMeta, useObservations, useRefData, useActions, useOutbox } from "../offline/store";
import { ackCritical, commentObservation, replyObservation } from "../offline/commands";
import { PendingMarkers, SubHead, ObsStatusChip, ActionRow, useOnlineOnly } from "../components/common";
import { PhotoStrip, photoBytes, type PhotoDraft } from "../components/media";
import { TriageSheet } from "../components/triage";
import { TYPE_TONE, obsTitle } from "../lib";
import type { ObservationCreate } from "../../shared/types";

export default function ObservationDetail() {
  const { id = "" } = useParams();
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const ref = useRefData();
  const { data: observations } = useObservations();
  const { data: actions } = useActions();
  const { data: outbox } = useOutbox();
  const local = observations.find((o) => o.id === id || o.clientUuid === id) ?? null;
  const isLocal = !!local?.local;
  const { data: detail, loading, error, reload, update, stale } = useDetail<Detail>("observation", isLocal ? null : id, () => api.get<Detail>(`/observations/${id}`));
  const obs = detail ?? local;
  const officer = isOfficer(me, obs?.siteId);
  const [triage, setTriage] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [reply, setReply] = useState<{ body: string; photos: PhotoDraft[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const { online } = useOnlineOnly();

  // photos still on this phone (unsynced report)
  const createCmd = useMemo(() => outbox.find((x) => x.entityType === "observation" && x.op === "create" && x.entityClientUuid === obs?.clientUuid), [outbox, obs?.clientUuid]);
  const mediaMeta = useMediaMeta();
  const localMedia = useMemo(() => mediaMeta.filter((m) => m.ownerClientUuid === obs?.clientUuid), [mediaMeta, obs?.clientUuid]);
  const previews = useLocalMediaPreviews(localMedia.filter((m) => m.ref.kind === "photo").map((m) => m.clientUuid));
  const localPayload = createCmd?.payload as ObservationCreate | undefined;
  const linkedActions = actions.filter((a) => a.sourceType === "observation" && (a.sourceId === obs?.id || a.sourceCaseNo === obs?.caseNo) && obs?.caseNo);
  const catName = (code: string) => pick(ref.categories.find((c) => c.code === code)?.name) || code;

  if (!obs && loading) return <div className="page"><SubHead title={t("obs.title")} /><Skeleton lines={8} /></div>;
  if (!obs) return <div className="page"><SubHead title={t("obs.title")} /><ErrorCard error={error ?? new Error(t("error.notFound"))} onRetry={reload} /></div>;

  const area = ref.areas.find((a) => a.id === obs.areaId);
  const site = ref.sites.find((s) => s.id === obs.siteId);
  const canTriage = detail ? detail.can.triage : officer && (obs.status === "submitted" || obs.status === "returned") && !isLocal;
  const canAck = detail ? detail.can.ackCritical : officer && obs.imminentDanger && !obs.criticalAckedAt;
  const canReply = detail ? detail.can.reply : obs.status === "returned" && obs.mine;
  const canComment = detail ? detail.can.comment : obs.mine || officer;
  const title = obsTitle(obs, ref, t, pick);

  const doAck = async () => {
    setBusy(true);
    try { await ackCritical(obs.id, `${t("obs.ack")} · ${obs.caseNo}`); toast.success(t("obs.ackSaved")); } finally { setBusy(false); }
  };
  const doComment = async () => {
    if (comment.trim().length < 2) return;
    setBusy(true);
    try { await commentObservation(obs.id, comment.trim(), `${t("common.comments")} · ${obs.caseNo}`); setComment(""); toast.success(t("obs.commentSaved")); } finally { setBusy(false); }
  };
  const doReply = async () => {
    if (!reply || reply.body.trim().length < 2) { toast.error(t("obs.replyNeedText")); return; }
    setBusy(true);
    try { await replyObservation(obs.id, reply.body.trim(), reply.photos.map(photoBytes), `${t("obs.reply")} · ${obs.caseNo}`); setReply(null); toast.success(t("obs.replySaved")); } finally { setBusy(false); }
  };

  const timeline = [
    ...(detail?.triage ?? []).map((tr) => ({ key: `t${tr.id}`, tone: (tr.decision === "accept_assign" ? "blue" : tr.decision === "discard" ? "red" : tr.decision === "escalate_incident" ? "red" : "green") as "blue" | "red" | "green", who: tr.decidedByName, when: relative(tr.decidedAt, t, lang), text: <>{t(`triage.decision.${tr.decision}`)}{tr.band ? <> · <BandPill band={tr.band} score={tr.likelihood && tr.severity ? tr.likelihood * tr.severity : null} /></> : null}{tr.reasonText ? <div className="small muted">{tr.reasonCode ? `${t(`triage.reason.${tr.reasonCode}`)} — ` : ""}{tr.reasonText}</div> : null}</>, at: tr.decidedAt })),
    ...(detail?.comments ?? []).map((c) => ({ key: `c${c.id}`, tone: (c.kind === "rejected_offline_decision" ? "red" : c.kind === "return_question" ? "hivis" : c.kind === "system" ? "grey" : "blue") as "red" | "hivis" | "grey" | "blue", who: c.userName ?? (c.kind === "system" ? t("common.system") : t("common.anonymous")), when: relative(c.createdAt, t, lang), text: <>{c.kind !== "comment" ? <span className="small muted">{t(`obs.commentKind.${c.kind}`)} · </span> : null}{c.body}</>, at: c.createdAt })),
    { key: "received", tone: "grey" as const, who: obs.anonymous ? t("common.anonymous") : obs.reporterName ?? (obs.mine ? t("common.you") : t("common.reporter")), when: relative(obs.receivedAt, t, lang), text: t("obs.received", { channel: t(`channel.${obs.channel}`) }), at: obs.receivedAt },
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <SubHead title={obs.caseNo || t("common.pendingNumber")} kicker={<span className="row" style={{ gap: 6 }}><Pill tone={TYPE_TONE[obs.type]}>{t(`type.${obs.type}`)}</Pill><ObsStatusChip status={obs.status} local={isLocal} />{obs.riskBand ? <BandPill band={obs.riskBand} score={detail?.riskScore} /> : null}</span>}
        right={canTriage ? <Button variant="primary" onClick={() => setTriage(true)} data-testid="triage-open">{t("triage.open")}</Button> : null} />
      <PendingMarkers targetId={obs.id} />
      {stale && !online ? <div className="stale">{t("common.offlineCopy")}</div> : null}
      {error && detail ? <div className="hint-box">{t("obs.refreshFailed")}</div> : null}

      {obs.imminentDanger ? (
        <div className="banner critical" style={{ marginBottom: 12 }}>
          <IconAlert size={18} />
          <span>{t("obs.dangerBanner")}{obs.criticalAckedAt ? ` · ${t("obs.ackedAt", { time: fmtDateTime(obs.criticalAckedAt, lang) })}` : ""}</span>
          <span className="spacer" />
          {canAck ? <Button size="sm" onClick={doAck} loading={busy} data-testid="ack-critical">{t("obs.ack")}</Button> : null}
        </div>
      ) : null}

      <Card>
        <h2 style={{ fontSize: 20 }}>{title}</h2>
        {(detail?.media?.length || localMedia.length) ? (
          <div className="evidence-grid" style={{ marginBottom: 10 }}>
            {detail?.media.filter((m) => m.kind === "photo").map((m) => (
              <Thumb key={m.id} src={m.url ? api.file(m.url) : undefined} media={m} alt={t("common.photo")} onClick={() => m.url && setView(api.file(m.url))} tag={m.purpose === "after" ? t("action.after") : m.redacted ? t("photo.blurred") : undefined} />
            ))}
            {localMedia.filter((m) => m.ref.kind === "photo").map((m) => (
              <Thumb key={m.clientUuid} src={previews[m.clientUuid]} pending={m.status !== "uploaded"} alt={t("common.photo")} onClick={() => previews[m.clientUuid] && setView(previews[m.clientUuid])} tag={m.status === "uploaded" ? undefined : t(`media.${m.status}`)} />
            ))}
          </div>
        ) : null}
        {detail?.media.filter((m) => m.kind === "audio" && m.url).map((m) => <audio key={m.id} controls src={api.file(m.url)} style={{ width: "100%", marginBottom: 8 }} />)}
        {localMedia.some((m) => m.ref.kind === "audio") ? <p className="small muted">{t("obs.voicePending")}</p> : null}
        {obs.description ? <p style={{ whiteSpace: "pre-wrap" }}>{obs.description}</p> : null}
        {(detail?.immediateAction || localPayload?.immediateAction) ? <p className="small"><b>{t("report.fixedOnSpot")}:</b> {detail?.immediateAction || localPayload?.immediateAction}</p> : null}
        <dl className="kv">
          <dt>{t("common.area")}</dt><dd><IconMapPin size={13} /> {site ? `${site.code} · ` : ""}{area ? pick(area.name) : pick(obs.areaName) || "—"}{detail?.assetId ? ` · ${ref.assets.find((a) => a.id === detail.assetId)?.tagNo ?? ""}` : ""}</dd>
          <dt>{t("common.time")}</dt><dd><IconClock size={13} /> {fmtDateTime(obs.capturedAt, lang)} <span className="muted small">{t("report.locked")}</span></dd>
          <dt>{t("common.gps")}</dt><dd>{(detail?.lat ?? localPayload?.lat) != null ? `${(detail?.lat ?? localPayload?.lat)!.toFixed(5)}, ${(detail?.lng ?? localPayload?.lng)!.toFixed(5)} ${(detail?.accuracyM ?? localPayload?.accuracyM) ? t("common.gpsAcc", { m: detail?.accuracyM ?? localPayload?.accuracyM }) : ""}` : t("common.gpsNone")}</dd>
          <dt>{t("common.categories")}</dt><dd>{obs.categoryCodes.map(catName).join(", ") || "—"}</dd>
          <dt>{t("common.reporter")}</dt><dd><IconUser size={13} /> {obs.anonymous ? t("common.anonymous") : obs.reporterName ?? (obs.mine ? t("common.you") : "—")}{detail?.reporterContact ? ` · ${detail.reporterContact.phone}` : ""}</dd>
          {detail?.employerInvolvedId || localPayload?.employerInvolvedId ? <><dt>{t("common.employer")}</dt><dd>{ref.contractors.find((c) => c.id === (detail?.employerInvolvedId ?? localPayload?.employerInvolvedId))?.name ?? "—"}</dd></> : null}
          {detail?.trade || localPayload?.trade ? <><dt>{t("common.trade")}</dt><dd>{t(`trade.${detail?.trade ?? localPayload?.trade}`)}</dd></> : null}
          {detail?.is3786Code ? <><dt>IS 3786</dt><dd>{detail.is3786Code}</dd></> : null}
          {detail?.masterCaseNo ? <><dt>{t("obs.mergedInto")}</dt><dd><IconMerge size={13} /> <button type="button" className="btn ghost sm" onClick={() => nav(`/o/${detail.masterObservationId}`)}>{detail.masterCaseNo}</button></dd></> : null}
          {Object.entries(detail?.extra ?? localPayload?.extra ?? {}).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{String(v)}</dd></div>)}
        </dl>
        {detail?.closureSummary ? <div className="banner synced" style={{ marginTop: 10 }}><span><b>{t("obs.closureSummary")}:</b> {detail.closureSummary}</span></div> : null}
      </Card>

      {canReply ? (
        <Card style={{ marginTop: 12 }} className="dup">
          <CardHead title={t("obs.returnedTitle")} />
          <p className="small">{detail?.comments.filter((c) => c.kind === "return_question").slice(-1)[0]?.body ?? t("obs.returnedBody")}</p>
          {reply ? (
            <>
              <Field label={t("obs.reply")} required><Textarea rows={3} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} maxLength={500} /></Field>
              <PhotoStrip photos={reply.photos} onChange={(photos) => setReply({ ...reply, photos })} max={3} purpose="evidence" />
              <div className="btn-group" style={{ marginTop: 10 }}><Button onClick={() => setReply(null)}>{t("common.cancel")}</Button><Button variant="primary" loading={busy} onClick={doReply}><IconSend size={16} /> {t("obs.sendReply")}</Button></div>
            </>
          ) : <Button variant="primary" onClick={() => setReply({ body: "", photos: [] })}>{t("obs.reply")}</Button>}
        </Card>
      ) : null}

      {linkedActions.length || detail?.actions?.length ? (
        <section style={{ marginTop: 14 }}>
          <h3>{t("common.actions")}</h3>
          <div className="list">{(linkedActions.length ? linkedActions : detail!.actions).map((a) => <ActionRow key={a.id} a={a} />)}</div>
        </section>
      ) : null}

      {officer && detail?.duplicates?.length ? (
        <section style={{ marginTop: 14 }}>
          <h3>{t("obs.duplicates")}</h3>
          <div className="list">
            {detail.duplicates.map((d: DuplicateSuggestion) => (
              <button key={d.id} type="button" className="decision-btn dup" onClick={() => nav(`/o/${d.id}`)}>
                <span><b className="mono">{d.caseNo}</b> · {t(`obs.status.${d.status}`)} · {relative(d.receivedAt, t, lang)}<br /><span className="small muted">{d.description.slice(0, 90)} — {d.reasons.join(", ")}</span></span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ marginTop: 14 }}>
        <h3>{t("common.timeline")}</h3>
        <Timeline items={timeline} />
        {canComment ? (
          <div className="input-row" style={{ marginTop: 8 }}>
            <Textarea rows={1} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("obs.commentPlaceholder")} maxLength={500} style={{ minHeight: 48 }} />
            <Button variant="primary" onClick={doComment} disabled={comment.trim().length < 2} loading={busy} aria-label={t("common.add")}><IconSend size={18} /></Button>
          </div>
        ) : null}
      </section>

      {view ? <Lightbox src={view} onClose={() => setView(null)} /> : null}
      {triage ? <TriageSheet obs={{ ...(detail ?? {}), ...obs } as never} duplicates={detail?.duplicates} onClose={() => setTriage(false)} onDone={() => { setTriage(false); if (detail) update({ ...detail }); }} /> : null}
      {!detail && !isLocal && !online && !loading ? <p className="hint-box" style={{ marginTop: 12 }}>{t("obs.noOfflineCopy")}</p> : null}
    </div>
  );
}
