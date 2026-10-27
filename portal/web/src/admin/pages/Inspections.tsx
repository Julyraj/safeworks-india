/* Inspection runs register with status filters, HTML report link, run drawer (answers, flags, repeat findings), reopen with reason (admin/HSE), cancel. */
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { RunDetail, RunStatus, RunSummary } from "../../shared/types";
import { Button, DataTable, EmptyState, ErrorCard, Pagination, Pill, Progress, SearchEmpty, Skeleton, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDateTime, dueText } from "../../shared/format";
import { IconExternal, IconUndo, IconX } from "../../shared/icons";
import { api, downloadCsv, openServerHtml } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { CountLine, DateRange, Drawer, ExportButton, FilterSelect, KV, PageHead, ReasonSheet, RegisterSearch, SavedFilters, useRegister, useRowNav, useUrlFilters } from "../components";

const STATUSES: RunStatus[] = ["scheduled", "in_progress", "completed", "closed", "missed", "cancelled", "reopened"];
const TONE: Record<RunStatus, "green" | "amber" | "orange" | "red" | "blue" | "grey"> = { scheduled: "blue", in_progress: "blue", completed: "green", closed: "green", missed: "red", cancelled: "grey", reopened: "orange" };

export default function Inspections() {
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();
  const { siteId, siteName } = useScope();
  const reg = useRegister<RunSummary>("inspections", "/inspections/runs");
  useUrlFilters(reg, ["status", "from", "to"]);
  const tableRef = useRef<HTMLDivElement>(null);
  useRowNav(tableRef, !id);

  const columns: Column<RunSummary>[] = [
    { key: "caseNo", label: t("ins.run"), render: (r) => <span className="case">{r.caseNo}</span>, width: 150 },
    { key: "template", label: t("templates.template"), render: (r) => <div><div className="cell-title">{pick(r.templateName)}</div><div className="cell-sub">{r.templateCode} · {t(`ins.trigger.${r.trigger}`)}{!siteId ? ` · ${siteName(r.siteId)}` : ""}</div></div> },
    { key: "status", label: t("common.status"), render: (r) => <Pill tone={TONE[r.status]}>{t(`run.status.${r.status}`)}</Pill>, width: 130 },
    { key: "result", label: t("ins.result"), render: (r) => r.result ? <span className="row nowrap" style={{ gap: 4 }}><Pill tone={r.result === "pass" ? "green" : "red"}>{t(`run.${r.result}`)}</Pill>{r.scorePct !== null ? <span className="small muted">{r.scorePct}%</span> : null}{r.failedCount ? <span className="small muted">· {t("ins.failedN", { n: r.failedCount })}</span> : null}</span> : "—", width: 170 },
    { key: "inspector", label: t("ins.inspector"), render: (r) => r.inspectorName ?? <span className="muted">—</span>, width: 140 },
    { key: "dueAt", label: t("common.dueDate"), render: (r) => { const dt = dueText(r.dueAt, r.status === "scheduled" || r.status === "in_progress", t); return <span className={`nowrap${dt.late ? " chain-bad" : ""}`} title={fmtDateTime(r.dueAt, lang)}>{r.dueAt ? dt.text : "—"}</span>; }, sortable: true, width: 130 },
    { key: "actionsRaised", label: t("common.actions"), render: (r) => r.actionsRaised || "—", num: true, width: 80 },
    { key: "report", label: t("ins.report"), render: (r) => r.status === "completed" || r.status === "closed" ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openServerHtml(`/inspections/runs/${r.id}/report`); }}><IconExternal size={14} />{t("ins.openReport")}</Button> : null, width: 120 },
  ];

  return (
    <>
      <PageHead title={t("nav.inspections")} sub={siteId ? siteName(siteId) : t("top.allSites")} tools={<ExportButton onExport={() => downloadCsv("/exports/inspections.csv", reg.queryParams, "inspections.csv")} />} />
      <div className="filters">
        <RegisterSearch reg={reg} placeholder={t("ins.searchPh")} />
        <FilterSelect label={t("common.status")} value={reg.filters.status ?? ""} onChange={(v) => reg.setFilter("status", v)} options={STATUSES.map((s) => ({ value: s, label: t(`run.status.${s}`) }))} />
        <DateRange from={reg.filters.from ?? ""} to={reg.filters.to ?? ""} onFrom={(v) => reg.setFilter("from", v)} onTo={(v) => reg.setFilter("to", v)} />
      </div>
      <SavedFilters reg={reg} />
      {reg.error && !reg.data ? <ErrorCard error={reg.error} onRetry={reg.reload} /> : null}
      <CountLine total={reg.data?.total} loading={reg.loading} />
      <div ref={tableRef}>
        <DataTable columns={columns} rows={reg.data?.items ?? []} rowKey={(r) => r.id} loading={reg.loading} sort={reg.sort ?? undefined} onSort={reg.toggleSort} onRow={(r) => nav(`/inspections/${r.id}`)}
          empty={reg.hasFilters ? <SearchEmpty q={reg.q} onClear={reg.clearFilters} /> : <EmptyState title={t("ins.empty")} body={t("ins.emptyHint")} action={<Link className="btn sm" to="/schedules">{t("nav.schedules")}</Link>} />} />
      </div>
      {reg.data ? <Pagination page={reg.data.page} pageSize={reg.data.pageSize} total={reg.data.total} onPage={reg.setPage} /> : null}
      {id ? <RunDrawer id={id} onClose={() => nav("/inspections")} onChanged={(d) => reg.patch((r) => r.id === d.id, (r) => ({ ...r, status: d.status }))} /> : null}
    </>
  );
}

function RunDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (d: RunDetail) => void }) {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { siteName, areaName } = useScope();
  const { perms } = useAuth();
  const state = useLoad(() => api.get<RunDetail>(`/inspections/runs/${id}`), [id]);
  const [reopen, setReopen] = useState(false);
  const [cancel, setCancel] = useState(false);
  const d = state.data;
  const apply = (nd: RunDetail) => { state.setData(nd); onChanged(nd); };
  const canReopen = d?.can.reopen && (perms.isAdmin || perms.isHse) && (d.status === "completed" || d.status === "closed");
  return (
    <Drawer title={d ? d.caseNo : t("common.loading")} kicker={d ? `${pick(d.templateName)} · ${siteName(d.siteId)}` : undefined} onClose={onClose} wide footer={d ? (
      <>
        {(d.status === "completed" || d.status === "closed" || d.status === "reopened") ? <Button variant="primary" onClick={() => openServerHtml(`/inspections/runs/${d.id}/report`)}><IconExternal size={16} />{t("ins.openReport")}</Button> : null}
        {canReopen && !perms.readOnly ? <Button onClick={() => setReopen(true)}><IconUndo size={16} />{t("ins.reopen")}</Button> : null}
        {d.can.cancel && !perms.readOnly && (d.status === "scheduled" || d.status === "in_progress") ? <Button variant="danger" onClick={() => setCancel(true)}><IconX size={16} />{t("ins.cancel")}</Button> : null}
        <span className="grow" /><Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
      </>
    ) : undefined}>
      {state.error && !d ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!d && !state.error ? <Skeleton lines={8} /> : null}
      {d ? (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row"><Pill tone={TONE[d.status]}>{t(`run.status.${d.status}`)}</Pill>{d.result ? <Pill tone={d.result === "pass" ? "green" : "red"}>{t(`run.${d.result}`)}</Pill> : null}{d.tagStatus ? <Pill tone={d.tagStatus === "safe_to_use" ? "green" : "red"}>{t(`ins.tag.${d.tagStatus}`)}</Pill> : null}</div>
          {d.scorePct !== null ? <div className="progress-wrap"><Progress value={d.scorePct} label={t("ins.score")} /><strong>{d.scorePct}%</strong></div> : null}
          <KV rows={[
            { k: t("common.area"), v: areaName(d.siteId, d.areaId) || "—" }, { k: t("ins.inspector"), v: d.inspectorName ?? "—" }, { k: t("ins.trigger"), v: t(`ins.trigger.${d.trigger}`) },
            { k: t("common.dueDate"), v: fmtDateTime(d.dueAt, lang) }, { k: t("ins.started"), v: fmtDateTime(d.startedAt, lang) }, { k: t("ins.completed"), v: fmtDateTime(d.completedAt, lang) },
            ...Object.entries(d.header ?? {}).map(([k, v]) => ({ k, v })),
            ...(d.immediateAction ? [{ k: t("obs.immediateAction"), v: d.immediateAction }] : []), ...(d.reopenReason ? [{ k: t("ins.reopenReason"), v: d.reopenReason }] : []),
          ]} />
          <div>
            <div className="section-title">{t("ins.answers")} ({d.answers.length})</div>
            {d.answers.length ? (
              <div className="table-wrap"><table className="table"><thead><tr><th>{t("dash.question")}</th><th>{t("ins.answer")}</th><th>{t("common.note")}</th><th>{t("common.actions")}</th></tr></thead>
                <tbody>{d.answers.map((a) => <tr key={a.id}><td className="mono-sm">{a.questionId.slice(0, 8)}{a.repeatIndex ? ` #${a.repeatIndex + 1}` : ""}</td><td><span className="row nowrap" style={{ gap: 4 }}>{a.flag ? <Pill tone="red">{String(a.value)}</Pill> : <span>{a.value === null || a.value === undefined ? "—" : String(a.value)}</span>}{a.repeatFinding ? <Pill tone="orange" title={t("dash.repeatKicker")}>{t("ins.repeat")}</Pill> : null}</span></td><td>{a.note || ""}</td><td>{a.actionId ? <Link to={`/actions/${a.actionId}`}>{t("common.open")}</Link> : ""}</td></tr>)}</tbody></table></div>
            ) : <p className="small muted">{t("ins.noAnswers")}</p>}
          </div>
        </div>
      ) : null}
      {reopen && d ? <ReasonSheet title={`${t("ins.reopen")} · ${d.caseNo}`} body={t("ins.reopenBody")} confirmLabel={t("ins.reopen")} onClose={() => setReopen(false)} onConfirm={async (reason) => { apply(await api.post<RunDetail>(`/inspections/runs/${d.id}/reopen`, { reason })); setReopen(false); toast.success(t("ins.reopened")); }} /> : null}
      {cancel && d ? <ReasonSheet danger title={`${t("ins.cancel")} · ${d.caseNo}`} confirmLabel={t("ins.cancel")} onClose={() => setCancel(false)} onConfirm={async (reason) => { apply(await api.post<RunDetail>(`/inspections/runs/${d.id}/cancel`, { reason })); setCancel(false); toast.success(t("ins.cancelled")); }} /> : null}
    </Drawer>
  );
}
