/* Actions register (overdue first) → detail drawer with timeline, pending requests to decide, reassign, cancel (site-head approval), export. */
import { useCallback, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { ActionDetail, ActionRequest, ActionRequestDecide, ActionStatus, ActionSummary, Band, UserAdmin } from "../../shared/types";
import { BandPill, Button, DataTable, EmptyState, ErrorCard, Field, Input, Lightbox, Pagination, Pill, SearchEmpty, Select, Sheet, Skeleton, Textarea, Thumb, Timeline, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { dueText, fmtDateTime } from "../../shared/format";
import { IconExternal, IconSwap, IconX } from "../../shared/icons";
import { uuid } from "../../shared/storage";
import { api, datetimeLocalValue, downloadCsv, errMessage, fromDatetimeLocal } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { CountLine, Drawer, ExportButton, FilterSelect, KV, PageHead, RegisterSearch, SavedFilters, UserPicker, useRegister, useRowNav, useUrlFilters } from "../components";

const STATUSES: ActionStatus[] = ["open", "in_progress", "completed", "verified", "reopened", "disputed", "cancelled"];
const BANDS: Band[] = ["extreme", "high", "moderate", "low"];
const TONE: Record<ActionStatus, "green" | "amber" | "orange" | "red" | "blue" | "grey"> = { open: "blue", in_progress: "blue", completed: "amber", verified: "green", reopened: "orange", disputed: "red", cancelled: "grey" };

export default function Actions() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();
  const { siteId, siteName } = useScope();
  const reg = useRegister<ActionSummary>("actions", "/actions");
  useUrlFilters(reg, ["status", "band", "overdue", "ownerId"]);
  const tableRef = useRef<HTMLDivElement>(null);
  useRowNav(tableRef, !id);
  const rows = [...(reg.data?.items ?? [])].sort((a, b) => Number(b.overdue) - Number(a.overdue));

  const columns: Column<ActionSummary>[] = [
    { key: "caseNo", label: t("act.case"), render: (r) => <span className="case">{r.caseNo}</span>, width: 150 },
    { key: "title", label: t("act.titleCol"), render: (r) => <div><div className="cell-title clamp-2">{r.title}</div><div className="cell-sub">{r.sourceCaseNo ? `${t(`act.source.${r.sourceType}`)} ${r.sourceCaseNo}` : t(`act.source.${r.sourceType}`)}{!siteId ? ` · ${siteName(r.siteId)}` : ""}</div></div> },
    { key: "band", label: t("common.risk"), render: (r) => <BandPill band={r.band} />, width: 110 },
    { key: "status", label: t("common.status"), render: (r) => <span className="row nowrap" style={{ gap: 4 }}><Pill tone={TONE[r.status]}>{t(`action.status.${r.status}`)}</Pill>{r.pendingRequest ? <Pill tone="amber" title={t(`act.request.${r.pendingRequest}`)}>?</Pill> : null}{r.reopenCount ? <Pill tone="grey" title={t("act.reopenCount", { n: r.reopenCount })}>↺{r.reopenCount}</Pill> : null}</span>, width: 180 },
    { key: "ownerName", label: t("common.owner"), render: (r) => r.ownerName, width: 150 },
    { key: "dueAt", label: t("common.dueDate"), render: (r) => { const dt = dueText(r.dueAt, !["verified", "cancelled"].includes(r.status), t); return <span className={`nowrap${dt.late ? " chain-bad" : ""}`} title={fmtDateTime(r.dueAt, lang)}>{dt.text}</span>; }, sortable: true, width: 140 },
  ];

  return (
    <>
      <PageHead title={t("nav.actions")} sub={siteId ? siteName(siteId) : t("top.allSites")} tools={<ExportButton onExport={() => downloadCsv("/exports/actions.csv", reg.queryParams, "actions.csv")} />} />
      <div className="filters">
        <RegisterSearch reg={reg} placeholder={t("act.searchPh")} />
        <FilterSelect label={t("common.status")} value={reg.filters.status ?? ""} onChange={(v) => reg.setFilter("status", v)} options={STATUSES.map((s) => ({ value: s, label: t(`action.status.${s}`) }))} />
        <FilterSelect label={t("common.risk")} value={reg.filters.band ?? ""} onChange={(v) => reg.setFilter("band", v)} options={BANDS.map((b) => ({ value: b, label: t(`band.${b}`) }))} />
        <FilterSelect label={t("act.overdueOnly")} value={reg.filters.overdue ?? ""} onChange={(v) => reg.setFilter("overdue", v)} options={[{ value: "1", label: t("act.overdue") }]} allLabel={t("common.all")} />
      </div>
      <SavedFilters reg={reg} />
      {reg.error && !reg.data ? <ErrorCard error={reg.error} onRetry={reg.reload} /> : null}
      <CountLine total={reg.data?.total} loading={reg.loading} />
      <div ref={tableRef}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={reg.loading} sort={reg.sort ?? undefined} onSort={reg.toggleSort} onRow={(r) => nav(`/actions/${r.id}`)}
          empty={reg.hasFilters ? <SearchEmpty q={reg.q} onClear={reg.clearFilters} /> : <EmptyState title={t("act.empty")} body={t("act.emptyHint")} />} />
      </div>
      {reg.data ? <Pagination page={reg.data.page} pageSize={reg.data.pageSize} total={reg.data.total} onPage={reg.setPage} /> : null}
      {id ? <ActionDrawer id={id} onClose={() => nav("/actions")} onChanged={(d) => reg.patch((r) => r.id === d.id, (r) => ({ ...r, status: d.status, dueAt: d.dueAt, overdue: d.overdue, ownerName: d.ownerName, ownerUserId: d.ownerUserId, pendingRequest: d.pendingRequest, reopenCount: d.reopenCount }))} /> : null}
    </>
  );
}

function ActionDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (d: ActionDetail) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { siteName, employerName, areaName } = useScope();
  const { perms } = useAuth();
  const state = useLoad(() => api.get<ActionDetail>(`/actions/${id}`), [id]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [decide, setDecide] = useState<ActionRequest | null>(null);
  const [reassign, setReassign] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const d = state.data;
  const apply = useCallback((nd: ActionDetail) => { state.setData(nd); onChanged(nd); }, [state, onChanged]);
  const open = d ? !["verified", "cancelled"].includes(d.status) : false;
  const due = d ? dueText(d.dueAt, open, t) : null;
  const pending = d?.requests.filter((r) => r.status === "pending") ?? [];
  const EVENT_TONE: Record<string, "green" | "red" | "blue" | "hivis" | "grey"> = { created: "blue", status_change: "blue", verification: "green", escalated: "red", reminder_sent: "grey", dispute_raised: "red", date_change_requested: "hivis", reassigned: "hivis", comment: "grey", attachment: "grey", date_change_decided: "blue", dispute_decided: "blue" };

  return (
    <Drawer title={d ? d.caseNo : t("common.loading")} kicker={d ? `${t("common.actions")} · ${siteName(d.siteId)}` : undefined} onClose={onClose} wide footer={d && !perms.readOnly ? (
      <>
        {pending.length && d.can.decide ? <Button variant="primary" onClick={() => setDecide(pending[0])}>{t("act.decideRequest")}</Button> : null}
        {d.can.reassign && open ? <Button onClick={() => setReassign(true)}><IconSwap size={16} />{t("act.reassign")}</Button> : null}
        {d.can.cancel && open ? <Button variant="danger" onClick={() => setCancel(true)}><IconX size={16} />{t("act.cancel")}</Button> : null}
        <span className="grow" />
        <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
      </>
    ) : undefined}>
      {state.error && !d ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!d && !state.error ? <Skeleton lines={8} /> : null}
      {d ? (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row"><Pill tone={TONE[d.status]}>{t(`action.status.${d.status}`)}</Pill><BandPill band={d.band} />{due ? <Pill tone={due.late ? "red" : due.soon ? "amber" : "grey"}>{due.text}</Pill> : null}{d.overdue ? <Pill tone="red" dot>{t("act.overdue")}</Pill> : null}{d.statutoryClock ? <Pill tone="orange">{d.statutoryClock}</Pill> : null}</div>
          <h3 style={{ margin: 0 }}>{d.title}</h3>
          {d.problem ? <p style={{ margin: 0 }}>{d.problem}</p> : null}
          {pending.length ? (
            <div className="banner warn" role="status"><span>{t("act.pendingRequest", { type: t(`act.request.${pending[0].type}`), who: pending[0].requestedByName })}{pending[0].proposedDueAt ? ` → ${fmtDateTime(pending[0].proposedDueAt, lang)}` : ""} — {pending[0].reason}</span></div>
          ) : null}
          {d.sourceMedia.length || d.events.some((e) => e.media.length) ? (
            <div className="compare">
              <figure><figcaption>{t("act.before")}</figcaption><div className="photo-grid">{d.sourceMedia.map((m) => <Thumb key={m.id} media={{ ...m, url: api.file(m.thumbUrl ?? m.url) }} onClick={m.url ? () => setLightbox(api.file(m.url)) : undefined} />)}</div></figure>
              <figure><figcaption>{t("act.after")}</figcaption><div className="photo-grid">{d.events.flatMap((e) => e.media).filter((m) => m.purpose === "after").map((m) => <Thumb key={m.id} media={{ ...m, url: api.file(m.thumbUrl ?? m.url) }} onClick={m.url ? () => setLightbox(api.file(m.url)) : undefined} />)}</div></figure>
            </div>
          ) : null}
          <KV rows={[
            { k: t("act.sourceCol"), v: d.sourceCaseNo ? <Link to={d.sourceType === "observation" ? `/observations/${d.sourceId}` : d.sourceType === "inspection_answer" ? `/inspections?q=${d.sourceCaseNo}` : "#"}>{t(`act.source.${d.sourceType}`)} {d.sourceCaseNo}</Link> : t(`act.source.${d.sourceType}`) },
            { k: t("common.owner"), v: d.ownerName }, { k: t("triage.responsibleEmployer"), v: d.responsibleEmployerId ? employerName(d.responsibleEmployerId) || d.responsibleEmployerId : t("common.ownCompany") },
            { k: t("common.area"), v: areaName(d.siteId, d.areaId) || "—" }, { k: t("triage.actionType"), v: t(`action.type.${d.actionType}`) }, { k: t("triage.controlLevel"), v: t(`control.${d.controlLevel}`) },
            { k: t("common.dueDate"), v: `${fmtDateTime(d.dueAt, lang)}${d.dueAt !== d.originalDueAt ? ` (${t("act.originally")} ${fmtDateTime(d.originalDueAt, lang)})` : ""}` },
            { k: t("triage.interimControl"), v: d.interimControl ? `${d.interimControl}${d.interimReviewAt ? ` · ${t("triage.interimReview")} ${fmtDateTime(d.interimReviewAt, lang)}` : ""}` : "—" },
            { k: t("act.completion"), v: d.completedAt ? `${d.completedByName ?? ""} · ${fmtDateTime(d.completedAt, lang)} — ${d.completionNote}${d.causeAddressed ? ` · ${t("act.cause")}: ${d.causeAddressed}` : ""}` : "—" },
            { k: t("act.verification"), v: d.verifiedAt ? `${d.verifierName ?? ""} · ${fmtDateTime(d.verifiedAt, lang)} · ${t(`verify.${d.verificationMethod || "re_inspection"}`)} · ${d.verificationResult === "effective" ? t("act.effective") : t("act.notEffective")}${d.verificationReason ? ` — ${d.verificationReason}` : ""}` : "—" },
            { k: t("act.escalationLevel"), v: String(d.escalationLevel) }, { k: t("act.reopenCountK"), v: String(d.reopenCount) },
            ...(d.cancelReason ? [{ k: t("act.cancelReason"), v: d.cancelReason }] : []),
          ]} />
          {d.requests.length ? (
            <div>
              <div className="section-title">{t("act.requests")}</div>
              <div className="table-wrap"><table className="table"><thead><tr><th>{t("act.requestType")}</th><th>{t("act.requestedBy")}</th><th>{t("act.proposed")}</th><th>{t("common.status")}</th><th>{t("act.decision")}</th></tr></thead>
                <tbody>{d.requests.map((r) => <tr key={r.id}><td>{t(`act.request.${r.type}`)}<div className="cell-sub">{r.reasonCode} · {r.reason}</div></td><td>{r.requestedByName}<div className="cell-sub">{fmtDateTime(r.createdAt, lang)}</div></td><td>{r.proposedDueAt ? fmtDateTime(r.proposedDueAt, lang) : "—"}</td><td><Pill tone={r.status === "pending" ? "amber" : r.status === "approved" ? "green" : "grey"}>{t(`act.requestStatus.${r.status}`)}</Pill></td><td>{r.decidedByName ? `${r.decidedByName} · ${fmtDateTime(r.decidedAt, lang)}` : ""}{r.decisionNote ? <div className="cell-sub">{r.decisionNote}</div> : null}{r.status === "pending" && d.can.decide && !perms.readOnly ? <Button size="sm" onClick={() => setDecide(r)}>{t("act.decide")}</Button> : null}</td></tr>)}</tbody></table></div>
            </div>
          ) : null}
          <div>
            <div className="section-title">{t("common.timeline")}</div>
            <Timeline items={d.events.map((e) => ({ key: e.id, tone: EVENT_TONE[e.eventType] ?? "grey", who: e.actorName ?? t("common.system"), when: fmtDateTime(e.at, lang),
              text: `${t(`act.event.${e.eventType}`)}${e.fromStatus && e.toStatus ? ` · ${t(`action.status.${e.fromStatus}`)} → ${t(`action.status.${e.toStatus}`)}` : ""}${e.body ? ` — ${e.body}` : ""}`,
              extra: e.media.length ? <div className="photo-grid" style={{ marginTop: 6 }}>{e.media.map((m) => <Thumb key={m.id} media={{ ...m, url: api.file(m.thumbUrl ?? m.url) }} tag={m.purpose} onClick={m.url ? () => setLightbox(api.file(m.url)) : undefined} />)}</div> : undefined }))} />
            {d.can.comment && !perms.readOnly ? (
              <div className="row nowrap" style={{ alignItems: "flex-start" }}>
                <div className="grow"><Field label={t("obs.addComment")}><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} /></Field></div>
                <Button style={{ marginTop: 26 }} disabled={comment.trim().length < 2} loading={busy} onClick={async () => {
                  setBusy(true);
                  try { const ev = await api.post<ActionDetail["events"][number]>(`/actions/${d.id}/comments`, { clientUuid: uuid(), body: comment.trim() }); state.setData({ ...d, events: [...d.events, ev] }); setComment(""); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); }
                }}>{t("obs.comment")}</Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {lightbox ? <Lightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
      {decide && d ? <DecideSheet action={d} request={decide} onClose={() => setDecide(null)} onDone={(nd) => { setDecide(null); apply(nd); }} /> : null}
      {reassign && d ? <ReassignSheet action={d} onClose={() => setReassign(false)} onDone={(nd) => { setReassign(false); apply(nd); }} /> : null}
      {cancel && d ? <CancelSheet action={d} onClose={() => setCancel(false)} onDone={(nd) => { setCancel(false); apply(nd); }} /> : null}
    </Drawer>
  );
}

function DecideSheet({ action, request, onClose, onDone }: { action: ActionDetail; request: ActionRequest; onClose: () => void; onDone: (d: ActionDetail) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [decision, setDecision] = useState<ActionRequestDecide["decision"]>("approved");
  const [note, setNote] = useState("");
  const [newDue, setNewDue] = useState(request.proposedDueAt ?? action.dueAt);
  const [owner, setOwner] = useState<{ id: string; name: string }>({ id: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Sheet title={`${t("act.decideRequest")} · ${t(`act.request.${request.type}`)}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant="primary" loading={busy} disabled={decision === "reassigned" && !owner.id} onClick={async () => {
        setBusy(true); setErr("");
        try {
          const body: ActionRequestDecide = { decision, note: note || undefined };
          if (decision === "reassigned") body.newOwnerUserId = owner.id;
          if (decision === "approved" && request.type === "date_change") body.newDueAt = newDue;
          onDone(await api.post<ActionDetail>(`/actions/${action.id}/requests/${request.id}/decide`, body)); toast.success(t("act.decided"));
        } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
      }}>{t("act.confirmDecision")}</Button>
    </>}>
      <KV rows={[{ k: t("act.requestedBy"), v: `${request.requestedByName} · ${fmtDateTime(request.createdAt, lang)}` }, { k: t("common.reason"), v: `${request.reasonCode ? `${request.reasonCode} · ` : ""}${request.reason}` }, ...(request.proposedDueAt ? [{ k: t("act.proposed"), v: fmtDateTime(request.proposedDueAt, lang) }] : [])]} />
      <Field label={t("act.decision")} required>
        <Select value={decision} onChange={(e) => setDecision(e.target.value as ActionRequestDecide["decision"])}>
          <option value="approved">{t("act.requestStatus.approved")}</option><option value="rejected">{t("act.requestStatus.rejected")}</option><option value="reassigned">{t("act.requestStatus.reassigned")}</option>
        </Select>
      </Field>
      {decision === "approved" && request.type === "date_change" ? <Field label={t("act.newDue")} required hint={t("act.originalKept")}><Input type="datetime-local" value={datetimeLocalValue(newDue)} onChange={(e) => setNewDue(fromDatetimeLocal(e.target.value))} /></Field> : null}
      {decision === "reassigned" ? <UserPicker label={t("act.newOwner")} required value={owner.id} valueName={owner.name} siteId={action.siteId} roleHint="action_owner" onChange={(id, u: UserAdmin | null) => setOwner({ id, name: u?.name ?? "" })} /> : null}
      <Field label={t("common.note")} optional><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

function ReassignSheet({ action, onClose, onDone }: { action: ActionDetail; onClose: () => void; onDone: (d: ActionDetail) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [owner, setOwner] = useState<{ id: string; name: string }>({ id: "", name: "" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Sheet title={`${t("act.reassign")} · ${action.caseNo}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant="primary" loading={busy} disabled={!owner.id || reason.trim().length < 3} onClick={async () => { setBusy(true); setErr(""); try { onDone(await api.post<ActionDetail>(`/actions/${action.id}/reassign`, { newOwnerUserId: owner.id, reason: reason.trim() })); toast.success(t("act.reassigned")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("act.reassign")}</Button>
    </>}>
      <p className="small muted">{t("act.currentOwner", { name: action.ownerName })}</p>
      <UserPicker label={t("act.newOwner")} required value={owner.id} valueName={owner.name} siteId={action.siteId} roleHint="action_owner" onChange={(id, u) => setOwner({ id, name: u?.name ?? "" })} />
      <Field label={t("common.reason")} required><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

function CancelSheet({ action, onClose, onDone }: { action: ActionDetail; onClose: () => void; onDone: (d: ActionDetail) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [approver, setApprover] = useState<{ id: string; name: string }>({ id: "", name: "" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Sheet title={`${t("act.cancel")} · ${action.caseNo}`} onClose={onClose} footer={<>
      <Button onClick={onClose}>{t("common.back")}</Button>
      <Button variant="danger" loading={busy} disabled={!approver.id || reason.trim().length < 3} onClick={async () => { setBusy(true); setErr(""); try { onDone(await api.post<ActionDetail>(`/actions/${action.id}/cancel`, { reason: reason.trim(), approvedByUserId: approver.id })); toast.success(t("act.cancelled")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("act.cancelConfirm")}</Button>
    </>}>
      <div className="banner warn" style={{ marginBottom: 12 }}>{t("act.cancelBody")}</div>
      <UserPicker label={t("act.approver")} required hint={t("act.approverHint")} value={approver.id} valueName={approver.name} siteId={action.siteId} roleHint="site_head" onChange={(id, u) => setApprover({ id, name: u?.name ?? "" })} />
      <Field label={t("common.reason")} required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
      <p className="small muted"><IconExternal size={12} style={{ display: "inline" }} /> {t("act.cancelAudit")}</p>
    </Sheet>
  );
}
