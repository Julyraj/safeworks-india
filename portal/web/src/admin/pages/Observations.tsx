/* Observations register → detail drawer (photos, timeline, actions, duplicates) → triage / reopen / ack critical / comment. */
import { useCallback, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { Band, ObservationDetail, ObservationStatus, ObservationSummary, ObservationType, Comment } from "../../shared/types";
import { BandPill, Button, DataTable, EmptyState, ErrorCard, Field, Lightbox, Pagination, Pill, SearchEmpty, Skeleton, Textarea, Thumb, Timeline, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDateTime, relative } from "../../shared/format";
import { IconAlert, IconCheck, IconExternal, IconFlag, IconUndo } from "../../shared/icons";
import { uuid } from "../../shared/storage";
import { api, downloadCsv, errMessage } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { CountLine, DateRange, Drawer, ExportButton, FilterSelect, KV, PageHead, ReasonSheet, RegisterSearch, SavedFilters, useRegister, useRowNav, useSiteAreas, useUrlFilters } from "../components";
import { TriageSheet } from "../components/Triage";

const STATUSES: ObservationStatus[] = ["submitted", "returned", "action_assigned", "escalated", "closed", "merged", "discarded"];
const BANDS: Band[] = ["extreme", "high", "moderate", "low"];
const TYPES: ObservationType[] = ["unsafe_condition", "unsafe_act", "near_miss", "good_practice"];
const STATUS_TONE: Record<ObservationStatus, "green" | "amber" | "orange" | "red" | "blue" | "grey"> = { submitted: "amber", returned: "blue", action_assigned: "blue", escalated: "red", closed: "green", merged: "grey", discarded: "grey" };

export default function Observations() {
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();
  const { siteId, siteName, categories, contractors } = useScope();
  const { perms } = useAuth();
  const reg = useRegister<ObservationSummary>("observations", "/observations");
  useUrlFilters(reg, ["status", "band", "type", "category", "areaId", "employerId", "from", "to"]);
  const { areas } = useSiteAreas(siteId);
  const tableRef = useRef<HTMLDivElement>(null);
  useRowNav(tableRef, !id);

  const columns: Column<ObservationSummary>[] = [
    { key: "caseNo", label: t("obs.case"), render: (r) => <span className="nowrap"><span className="case">{r.caseNo}</span>{r.imminentDanger ? <Pill tone="red" title={t("obs.dangerNow")}><IconAlert size={12} /></Pill> : null}{r.riskBand === "extreme" && !r.criticalAckedAt && r.status !== "closed" ? <Pill tone="red" title={t("obs.unacked")}>!</Pill> : null}</span>, width: 150 },
    { key: "type", label: t("obs.type"), render: (r) => t(`type.${r.type}`), width: 120 },
    { key: "description", label: t("common.description"), render: (r) => <div><div className="clamp-2">{r.description}</div><div className="cell-sub">{r.categoryCodes.join(", ")}{r.areaName ? ` · ${pick(r.areaName)}` : ""}{!siteId ? ` · ${siteName(r.siteId)}` : ""}</div></div> },
    { key: "riskBand", label: t("common.risk"), render: (r) => <BandPill band={r.riskBand} />, width: 110 },
    { key: "status", label: t("common.status"), render: (r) => <Pill tone={STATUS_TONE[r.status]}>{t(`obs.status.${r.status}`)}</Pill>, width: 150 },
    { key: "receivedAt", label: t("obs.received"), render: (r) => <span className="nowrap" title={fmtDateTime(r.receivedAt, lang)}>{relative(r.receivedAt, t, lang)}</span>, sortable: true, width: 120 },
    { key: "reporter", label: t("common.reporter"), render: (r) => r.anonymous ? <span className="muted">{t("common.anonymous")}</span> : (r.reporterName ?? <span className="muted">—</span>), width: 140 },
    { key: "actions", label: t("common.actions"), render: (r) => r.totalActions ? <span className="nowrap">{r.openActions}/{r.totalActions}</span> : "—", num: true, width: 80 },
  ];

  return (
    <>
      <PageHead title={t("nav.observations")} sub={siteId ? siteName(siteId) : t("top.allSites")} tools={<ExportButton onExport={() => downloadCsv("/exports/observations.csv", reg.queryParams, "observations.csv")} />} />
      <div className="filters">
        <RegisterSearch reg={reg} placeholder={t("obs.searchPh")} />
        <FilterSelect label={t("common.status")} value={reg.filters.status ?? ""} onChange={(v) => reg.setFilter("status", v)} options={STATUSES.map((s) => ({ value: s, label: t(`obs.status.${s}`) }))} />
        <FilterSelect label={t("common.risk")} value={reg.filters.band ?? ""} onChange={(v) => reg.setFilter("band", v)} options={BANDS.map((b) => ({ value: b, label: t(`band.${b}`) }))} />
        <FilterSelect label={t("obs.type")} value={reg.filters.type ?? ""} onChange={(v) => reg.setFilter("type", v)} options={TYPES.map((x) => ({ value: x, label: t(`type.${x}`) }))} />
        <FilterSelect label={t("common.category")} value={reg.filters.category ?? ""} onChange={(v) => reg.setFilter("category", v)} options={categories.data.map((c) => ({ value: c.code, label: pick(c.name) }))} />
        {siteId ? <FilterSelect label={t("common.area")} value={reg.filters.areaId ?? ""} onChange={(v) => reg.setFilter("areaId", v)} options={areas.map((a) => ({ value: a.id, label: pick(a.name) }))} /> : null}
        <FilterSelect label={t("common.employer")} value={reg.filters.employerId ?? ""} onChange={(v) => reg.setFilter("employerId", v)} options={contractors.data.map((c) => ({ value: c.id, label: c.name }))} />
        <DateRange from={reg.filters.from ?? ""} to={reg.filters.to ?? ""} onFrom={(v) => reg.setFilter("from", v)} onTo={(v) => reg.setFilter("to", v)} />
      </div>
      <SavedFilters reg={reg} />
      {reg.error && !reg.data ? <ErrorCard error={reg.error} onRetry={reg.reload} /> : null}
      <CountLine total={reg.data?.total} loading={reg.loading} />
      <div ref={tableRef}>
        <DataTable columns={columns} rows={reg.data?.items ?? []} rowKey={(r) => r.id} loading={reg.loading} sort={reg.sort ?? undefined} onSort={reg.toggleSort} onRow={(r) => nav(`/observations/${r.id}`)}
          empty={reg.hasFilters ? <SearchEmpty q={reg.q} onClear={reg.clearFilters} /> : <EmptyState title={t("obs.empty")} body={t("obs.emptyHint")} />} />
      </div>
      {reg.data ? <Pagination page={reg.data.page} pageSize={reg.data.pageSize} total={reg.data.total} onPage={reg.setPage} /> : null}
      {id ? <ObservationDrawer id={id} onClose={() => nav("/observations")} onChanged={(d) => reg.patch((r) => r.id === d.id, (r) => ({ ...r, status: d.status, riskBand: d.riskBand, openActions: d.openActions, totalActions: d.totalActions, criticalAckedAt: d.criticalAckedAt, triagedAt: d.triagedAt }))} canTriage={perms.canTriage} />
        : null}
    </>
  );
}

function ObservationDrawer({ id, onClose, onChanged, canTriage }: { id: string; onClose: () => void; onChanged: (d: ObservationDetail) => void; canTriage: boolean }) {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { siteName, employerName, areaName } = useScope();
  const { perms } = useAuth();
  const state = useLoad(() => api.get<ObservationDetail>(`/observations/${id}`), [id]);
  const [triage, setTriage] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const d = state.data;
  const apply = useCallback((nd: ObservationDetail) => { state.setData(nd); onChanged(nd); }, [state, onChanged]);

  const timeline = d ? [
    { key: "received", tone: "blue" as const, who: d.anonymous ? t("common.anonymous") : (d.reporterName ?? t("common.reporter")), when: fmtDateTime(d.receivedAt, lang), text: t("obs.tl.received", { channel: t(`obs.channel.${d.channel}`) }) },
    ...d.triage.map((x) => ({ key: x.id, tone: (x.decision === "discard" ? "red" : x.decision === "reopen" ? "hivis" : "green") as "red" | "hivis" | "green", who: x.decidedByName, when: fmtDateTime(x.decidedAt, lang), text: `${t(`triage.decision.${x.decision}`)}${x.band ? ` · ${t(`band.${x.band}`)} (${x.likelihood}×${x.severity})` : ""}${x.reasonText ? ` — ${x.reasonText}` : ""}` })),
    ...d.comments.map((c: Comment) => ({ key: c.id, tone: (c.kind === "rejected_offline_decision" ? "red" : c.kind === "system" ? "grey" : "blue") as "red" | "grey" | "blue", who: c.userName ?? t("common.system"), when: fmtDateTime(c.createdAt, lang), text: `${c.kind !== "comment" ? `[${t(`obs.comment.${c.kind}`)}] ` : ""}${c.body}` })),
    ...(d.closedAt ? [{ key: "closed", tone: "green" as const, who: t("common.system"), when: fmtDateTime(d.closedAt, lang), text: d.closureSummary || t("obs.status.closed") }] : []),
  ].sort((a, b) => a.when.localeCompare(b.when)) : [];

  return (
    <Drawer title={d ? d.caseNo : t("common.loading")} kicker={d ? `${t(`type.${d.type}`)} · ${siteName(d.siteId)}` : undefined} onClose={onClose} wide footer={d ? (
      <>
        {canTriage && d.can.triage ? <Button variant="primary" onClick={() => setTriage(true)}>{t("triage.title")}</Button> : null}
        {d.can.ackCritical && !d.criticalAckedAt ? <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { apply(await api.post<ObservationDetail>(`/observations/${d.id}/ack-critical`)); toast.success(t("obs.acked")); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); } }}><IconCheck size={16} />{t("obs.ackCritical")}</Button> : null}
        {d.can.reopen && d.status === "closed" ? <Button onClick={() => setReopen(true)}><IconUndo size={16} />{t("obs.reopen")}</Button> : null}
        <span className="grow" />
        <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
      </>
    ) : undefined}>
      {state.error && !d ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!d && !state.error ? <Skeleton lines={8} /> : null}
      {d ? (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row">
            <Pill tone={STATUS_TONE[d.status]}>{t(`obs.status.${d.status}`)}</Pill>
            <BandPill band={d.riskBand} score={d.riskScore} />
            {d.imminentDanger ? <Pill tone="red" dot>{t("obs.dangerNow")}</Pill> : null}
            {d.fixedOnSpot ? <Pill tone="green">{t("obs.fixedOnSpot")}</Pill> : null}
            {d.riskBand === "extreme" ? (d.criticalAckedAt ? <Pill tone="green">{t("obs.ackedAt", { time: fmtDateTime(d.criticalAckedAt, lang) })}</Pill> : <Pill tone="red">{t("obs.unacked")}</Pill>) : null}
          </div>
          <p style={{ fontSize: 16, margin: 0 }}>{d.description}</p>
          {d.media.length ? (
            <div className="photo-grid">
              {d.media.filter((m) => m.kind === "photo").map((m) => <Thumb key={m.id} media={{ ...m, url: api.file(m.thumbUrl ?? m.url) }} alt={m.purpose} tag={m.purpose} onClick={m.url ? () => setLightbox(api.file(m.url)) : undefined} />)}
            </div>
          ) : <p className="small muted" style={{ margin: 0 }}>{t("obs.noPhotos")}</p>}
          {d.media.some((m) => m.kind === "audio") ? d.media.filter((m) => m.kind === "audio" && m.url).map((m) => <audio key={m.id} controls src={api.file(m.url)} style={{ width: "100%" }} />) : null}
          <KV rows={[
            { k: t("common.site"), v: siteName(d.siteId) }, { k: t("common.area"), v: d.areaName ? pick(d.areaName) : areaName(d.siteId, d.areaId) || "—" },
            { k: t("common.categories"), v: d.categoryCodes.join(", ") || "—" }, { k: t("obs.taskObserved"), v: d.taskObserved || "—" },
            { k: t("common.reporter"), v: d.anonymous ? t("common.anonymous") : (d.reporterName ?? "—") },
            ...(d.reporterContact ? [{ k: t("obs.reporterContact"), v: `${d.reporterContact.name} · ${d.reporterContact.phone}` }] : []),
            { k: t("obs.channel"), v: t(`obs.channel.${d.channel}`) }, { k: t("obs.captured"), v: fmtDateTime(d.capturedAt, lang) }, { k: t("obs.received"), v: fmtDateTime(d.receivedAt, lang) },
            { k: t("common.gps"), v: d.lat !== null && d.lng !== null ? <a href={`https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=18/${d.lat}/${d.lng}`} target="_blank" rel="noreferrer">{d.lat.toFixed(5)}, {d.lng.toFixed(5)} {d.accuracyM ? t("common.gpsAcc", { m: d.accuracyM }) : ""}<IconExternal size={12} /></a> : t("common.gpsNone") },
            { k: t("common.employer"), v: d.employerInvolvedId ? employerName(d.employerInvolvedId) || d.employerInvolvedId : t("common.ownCompany") }, { k: t("common.trade"), v: d.trade || "—" },
            { k: t("triage.is3786"), v: d.is3786Code || "—" }, { k: t("obs.immediateAction"), v: d.immediateAction || "—" },
            ...(d.masterCaseNo ? [{ k: t("obs.mergedInto"), v: <Link to={`/observations/${d.masterObservationId}`}>{d.masterCaseNo}</Link> }] : []),
            ...(d.escalatedIncidentId ? [{ k: t("obs.incident"), v: `${d.caseNo} · ${t("obs.learnedAt")} ${fmtDateTime(d.learnedAt, lang)}` }] : []),
            ...Object.entries(d.extra ?? {}).map(([k, v]) => ({ k, v: String(v) })),
          ]} />
          {d.duplicates && d.duplicates.length ? (
            <div>
              <div className="section-title">{t("obs.duplicates")}</div>
              <div className="list-compact">{d.duplicates.map((x) => <Link key={x.id} to={`/observations/${x.id}`} className="li"><span className="case">{x.caseNo}</span><span className="sp truncate">{x.description}</span><span className="small muted">{x.reasons.join(", ")}</span></Link>)}</div>
            </div>
          ) : null}
          <div>
            <div className="section-title">{t("common.actions")} ({d.actions.length})</div>
            {d.actions.length ? (
              <div className="list-compact">
                {d.actions.map((a) => (
                  <Link key={a.id} to={`/actions/${a.id}`} className="li">
                    <span className="case">{a.caseNo}</span><span className="sp truncate">{a.title}</span><BandPill band={a.band} />
                    <Pill tone={a.overdue ? "red" : a.status === "verified" ? "green" : "blue"}>{t(`action.status.${a.status}`)}</Pill>
                    <span className="small muted nowrap">{a.ownerName}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="small muted">{t("obs.noActions")}</p>}
          </div>
          <div>
            <div className="section-title">{t("common.timeline")}</div>
            <Timeline items={timeline} />
            {d.can.comment && !perms.readOnly ? (
              <div className="row nowrap" style={{ alignItems: "flex-start" }}>
                <div className="grow"><Field label={t("obs.addComment")}><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></Field></div>
                <Button style={{ marginTop: 26 }} disabled={comment.trim().length < 2} loading={busy} onClick={async () => {
                  setBusy(true);
                  try { const c = await api.post<Comment>(`/observations/${d.id}/comments`, { clientUuid: uuid(), body: comment.trim() }); state.setData({ ...d, comments: [...d.comments, c] }); setComment(""); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); }
                }}>{t("obs.comment")}</Button>
              </div>
            ) : null}
          </div>
          {!canTriage && d.status === "submitted" ? <div className="banner info"><IconFlag size={16} />{t("obs.adminCannotTriage")}</div> : null}
        </div>
      ) : null}
      {lightbox ? <Lightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
      {triage && d ? <TriageSheet obs={d} onClose={() => setTriage(false)} onDone={(nd) => { setTriage(false); apply(nd); }} /> : null}
      {reopen && d ? <ReasonSheet title={`${t("obs.reopen")} · ${d.caseNo}`} body={t("obs.reopenBody")} confirmLabel={t("obs.reopen")} onClose={() => setReopen(false)}
        onConfirm={async (reason) => { apply(await api.post<ObservationDetail>(`/observations/${d.id}/reopen`, { reason })); setReopen(false); toast.success(t("obs.reopened")); }} /> : null}
    </Drawer>
  );
}
