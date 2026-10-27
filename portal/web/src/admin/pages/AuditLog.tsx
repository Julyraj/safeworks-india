/* Audit log: register with filters, changes diff viewer, "Verify chain" → result banner. */
import { useRef, useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { AuditRow, AuditVerify } from "../../shared/types";
import { Banner, Button, DataTable, EmptyState, ErrorCard, Field, Input, Pagination, Pill, SearchEmpty, useToast, type Column } from "../../shared/ui";
import { fmtDateTime } from "../../shared/format";
import { IconCheckCircle, IconAlert, IconShield } from "../../shared/icons";
import { api, errMessage, localCsv } from "../api";
import { useAuth } from "../auth";
import { useScope } from "../scope";
import { CountLine, DateRange, Drawer, ExportButton, FilterSelect, KV, PageHead, RegisterSearch, SavedFilters, useRegister, useRowNav } from "../components";

const ACTIONS = ["create", "update", "transition", "delete", "login", "login_failed", "permission_change", "config_change", "export", "sensitive_view", "mfa_enrol", "triage", "verify", "reopen", "cancel"];
const RECORD_TYPES = ["observation", "action", "inspection_run", "template_version", "user", "site", "area", "asset", "qr_code", "category", "risk_matrix_version", "rule_set", "settings", "translation", "privacy_request"];

function Diff({ changes }: { changes: Record<string, unknown> }) {
  const entries = Object.entries(changes ?? {});
  if (!entries.length) return <span className="muted small">—</span>;
  return (
    <div className="diff">
      {entries.map(([k, v]) => {
        const pair = v && typeof v === "object" && ("from" in (v as object) || "to" in (v as object)) ? (v as { from?: unknown; to?: unknown }) : null;
        return (
          <div key={k}><span className="k">{k}</span>: {pair ? <><span className="from">{JSON.stringify(pair.from)}</span> → <span className="to">{JSON.stringify(pair.to)}</span></> : <span className="to">{typeof v === "string" ? v : JSON.stringify(v)}</span>}</div>
        );
      })}
    </div>
  );
}

export default function AuditLog() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { sites } = useScope();
  const reg = useRegister<AuditRow>("audit", "/admin/audit-log", { pageSize: 50, scopeSite: false });
  const [sel, setSel] = useState<AuditRow | null>(null);
  const [verify, setVerify] = useState<AuditVerify | null>(null);
  const [verifying, setVerifying] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  useRowNav(tableRef, !sel);
  const runVerify = async () => {
    setVerifying(true);
    try { setVerify(await api.post<AuditVerify>("/admin/audit-log/verify")); } catch (e) { toast.error(errMessage(e)); } finally { setVerifying(false); }
  };
  const columns: Column<AuditRow>[] = [
    { key: "at", label: t("audit.at"), render: (r) => <span className="nowrap">{fmtDateTime(r.at, lang)}</span>, sortable: true, width: 140 },
    { key: "actor", label: t("audit.actor"), render: (r) => <div>{r.actorName ?? <span className="muted">{t("common.system")}</span>}<div className="cell-sub">{r.actorRole}</div></div>, width: 160 },
    { key: "action", label: t("audit.action"), render: (r) => <Pill tone={/fail|delete|cancel/.test(r.action) ? "red" : /login|view|export/.test(r.action) ? "grey" : "blue"}>{r.action}</Pill>, width: 140 },
    { key: "record", label: t("audit.record"), render: (r) => <div>{r.recordType}<div className="cell-sub mono-sm">{r.recordId}</div></div> },
    { key: "site", label: t("common.site"), render: (r) => r.siteCode ?? "—", width: 80 },
    { key: "changes", label: t("audit.changes"), render: (r) => <span className="small muted">{Object.keys(r.changes ?? {}).slice(0, 4).join(", ")}{Object.keys(r.changes ?? {}).length > 4 ? "…" : ""}{r.reason ? ` · ${r.reason}` : ""}</span> },
    { key: "hash", label: t("audit.hash"), render: (r) => <span className="mono-sm" title={r.hash}>{r.hash.slice(0, 10)}…</span>, width: 110 },
  ];
  return (
    <>
      <PageHead title={t("nav.auditLog")} sub={t("audit.sub")} tools={<>
        <ExportButton onExport={async () => localCsv((reg.data?.items ?? []).map((r) => ({ id: r.id, at: r.at, actor: r.actorName ?? "", role: r.actorRole, action: r.action, record_type: r.recordType, record_id: r.recordId, site: r.siteCode ?? "", reason: r.reason, changes: JSON.stringify(r.changes), hash: r.hash })), "audit-log.csv")} />
        {(perms.isAdmin || perms.isHse || perms.isAuditor) ? <Button variant="primary" size="sm" loading={verifying} onClick={runVerify}><IconShield size={14} />{t("audit.verify")}</Button> : null}
      </>} />
      {verify ? (
        <div style={{ marginBottom: 12 }}>
          <Banner tone={verify.ok ? "synced" : "critical"} icon={verify.ok ? <IconCheckCircle size={18} /> : <IconAlert size={18} />} action={<Button size="sm" variant="ghost" onClick={() => setVerify(null)}>{t("common.close")}</Button>}>
            {verify.ok ? t("audit.chainOk", { rows: verify.rows, at: fmtDateTime(verify.checkedAt, lang) }) : t("audit.chainBad", { rows: verify.rows, id: verify.firstBadId ?? "?", at: fmtDateTime(verify.checkedAt, lang) })}
          </Banner>
        </div>
      ) : null}
      <div className="filters">
        <RegisterSearch reg={reg} placeholder={t("audit.searchPh")} />
        <Field label={t("audit.actor")}><Input value={reg.filters.actor ?? ""} onChange={(e) => reg.setFilter("actor", e.target.value)} /></Field>
        <FilterSelect label={t("audit.action")} value={reg.filters.action ?? ""} onChange={(v) => reg.setFilter("action", v)} options={ACTIONS.map((a) => ({ value: a, label: a }))} />
        <FilterSelect label={t("audit.recordType")} value={reg.filters.recordType ?? ""} onChange={(v) => reg.setFilter("recordType", v)} options={RECORD_TYPES.map((a) => ({ value: a, label: a }))} />
        <Field label={t("audit.recordId")}><Input value={reg.filters.recordId ?? ""} onChange={(e) => reg.setFilter("recordId", e.target.value)} className="mono-sm" /></Field>
        <FilterSelect label={t("common.site")} value={reg.filters.siteCode ?? ""} onChange={(v) => reg.setFilter("siteCode", v)} options={sites.map((s) => ({ value: s.code, label: s.code }))} />
        <DateRange from={reg.filters.from ?? ""} to={reg.filters.to ?? ""} onFrom={(v) => reg.setFilter("from", v)} onTo={(v) => reg.setFilter("to", v)} />
      </div>
      <SavedFilters reg={reg} />
      {reg.error && !reg.data ? <ErrorCard error={reg.error} onRetry={reg.reload} /> : null}
      <CountLine total={reg.data?.total} loading={reg.loading} />
      <div ref={tableRef}>
        <DataTable columns={columns} rows={reg.data?.items ?? []} rowKey={(r) => String(r.id)} loading={reg.loading} sort={reg.sort ?? undefined} onSort={reg.toggleSort} onRow={setSel}
          empty={reg.hasFilters ? <SearchEmpty q={reg.q} onClear={reg.clearFilters} /> : <EmptyState title={t("audit.empty")} body={t("audit.emptyHint")} />} />
      </div>
      {reg.data ? <Pagination page={reg.data.page} pageSize={reg.data.pageSize} total={reg.data.total} onPage={reg.setPage} /> : null}
      {sel ? (
        <Drawer title={`${sel.action} · ${sel.recordType}`} kicker={`#${sel.id} · ${fmtDateTime(sel.at, lang)}`} onClose={() => setSel(null)} wide>
          <KV rows={[{ k: t("audit.actor"), v: `${sel.actorName ?? t("common.system")} (${sel.actorRole})` }, { k: t("audit.record"), v: <span className="mono-sm">{sel.recordType} / {sel.recordId}</span> }, { k: t("common.site"), v: sel.siteCode ?? "—" }, { k: t("common.reason"), v: sel.reason || "—" }, { k: t("audit.hash"), v: <span className="mono-sm" style={{ wordBreak: "break-all" }}>{sel.hash}</span> }]} />
          <div className="section-title">{t("audit.changes")}</div>
          <Diff changes={sel.changes} />
          <p className="small muted" style={{ marginTop: 12 }}>{t("audit.maskedNote")}</p>
        </Drawer>
      ) : null}
    </>
  );
}
