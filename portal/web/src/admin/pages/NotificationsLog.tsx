/* Notifications log: what was sent (push/email), to whom, status and errors. */
import { useRef } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import { DataTable, EmptyState, ErrorCard, Pagination, Pill, SearchEmpty, type Column } from "../../shared/ui";
import { fmtDateTime } from "../../shared/format";
import { localCsv } from "../api";
import type { NotificationLogRow } from "../types";
import { CountLine, DateRange, ExportButton, FilterSelect, PageHead, RegisterSearch, SavedFilters, useRegister, useRowNav } from "../components";

const STATUSES: NotificationLogRow["status"][] = ["queued", "sent", "delivered", "failed", "acknowledged"];
const TONE: Record<NotificationLogRow["status"], "green" | "amber" | "red" | "blue" | "grey"> = { queued: "amber", sent: "blue", delivered: "green", failed: "red", acknowledged: "green" };

export default function NotificationsLog() {
  const { t, lang } = useI18n();
  const reg = useRegister<NotificationLogRow>("notif", "/admin/notifications-log", { pageSize: 50 });
  const tableRef = useRef<HTMLDivElement>(null);
  useRowNav(tableRef);
  const link = (r: NotificationLogRow) => r.recordType === "observation" ? `/observations/${r.recordId}` : r.recordType === "action" ? `/actions/${r.recordId}` : r.recordType === "inspection_run" ? `/inspections/${r.recordId}` : null;
  const columns: Column<NotificationLogRow>[] = [
    { key: "at", label: t("audit.at"), render: (r) => <span className="nowrap">{fmtDateTime(r.at, lang)}</span>, sortable: true, width: 140 },
    { key: "event", label: t("notif.event"), render: (r) => <div>{r.eventType}{r.critical ? <Pill tone="red" dot>{t("notif.critical")}</Pill> : null}<div className="cell-sub">{r.title}</div></div> },
    { key: "recipient", label: t("notif.recipient"), render: (r) => r.recipientName ?? "—", width: 160 },
    { key: "channel", label: t("due.channel"), render: (r) => t(`due.channel.${r.channel}`), width: 90 },
    { key: "status", label: t("common.status"), render: (r) => <div><Pill tone={TONE[r.status]}>{t(`notif.status.${r.status}`)}</Pill>{r.error ? <div className="cell-sub" style={{ color: "var(--red)" }}>{r.error}</div> : null}</div>, width: 180 },
    { key: "record", label: t("audit.record"), render: (r) => { const l = link(r); return l ? <Link to={l}>{r.recordType}</Link> : (r.recordType ?? "—"); }, width: 120 },
  ];
  return (
    <>
      <PageHead title={t("nav.notificationsLog")} sub={t("notif.sub")} tools={<ExportButton onExport={async () => localCsv((reg.data?.items ?? []).map((r) => ({ at: r.at, event: r.eventType, title: r.title, recipient: r.recipientName ?? "", channel: r.channel, status: r.status, critical: r.critical, error: r.error })), "notifications-log.csv")} />} />
      <div className="filters">
        <RegisterSearch reg={reg} placeholder={t("notif.searchPh")} />
        <FilterSelect label={t("common.status")} value={reg.filters.status ?? ""} onChange={(v) => reg.setFilter("status", v)} options={STATUSES.map((s) => ({ value: s, label: t(`notif.status.${s}`) }))} />
        <FilterSelect label={t("due.channel")} value={reg.filters.channel ?? ""} onChange={(v) => reg.setFilter("channel", v)} options={["push", "email"].map((c) => ({ value: c, label: t(`due.channel.${c}`) }))} />
        <DateRange from={reg.filters.from ?? ""} to={reg.filters.to ?? ""} onFrom={(v) => reg.setFilter("from", v)} onTo={(v) => reg.setFilter("to", v)} />
      </div>
      <SavedFilters reg={reg} />
      {reg.error && !reg.data ? <ErrorCard error={reg.error} onRetry={reg.reload} /> : null}
      <CountLine total={reg.data?.total} loading={reg.loading} />
      <div ref={tableRef}>
        <DataTable columns={columns} rows={reg.data?.items ?? []} rowKey={(r) => String(r.id)} loading={reg.loading} sort={reg.sort ?? undefined} onSort={reg.toggleSort}
          empty={reg.hasFilters ? <SearchEmpty q={reg.q} onClear={reg.clearFilters} /> : <EmptyState title={t("notif.empty")} body={t("notif.emptyHint")} />} />
      </div>
      {reg.data ? <Pagination page={reg.data.page} pageSize={reg.data.pageSize} total={reg.data.total} onPage={reg.setPage} /> : null}
    </>
  );
}
