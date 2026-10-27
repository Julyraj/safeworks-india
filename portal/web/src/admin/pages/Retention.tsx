/* Retention: policies table (keep months, action, legal basis, status label), legal holds (create / release), dry-run report. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Button, Card, CardHead, EmptyState, ErrorCard, Field, Input, Pill, Select, Sheet, Skeleton, Textarea, useToast } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDateTime } from "../../shared/format";
import { IconHistory, IconPlus, IconPlay } from "../../shared/icons";
import { api, asList, errMessage, localCsv } from "../api";
import { useAuth } from "../auth";
import { useScope } from "../scope";
import type { LegalHold, RetentionDryRun, RetentionPolicy } from "../types";
import { AsyncButton, ExportButton, PageHead, StatusTag } from "../components";

const DEFAULT_POLICIES: RetentionPolicy[] = [
  { recordType: "observation", keepMonths: 60, action: "anonymise", legalBasis: "FA s.88 / BOCW records; DPDP s.8(7)", statusLabel: "design default" },
  { recordType: "action", keepMonths: 60, action: "keep", legalBasis: "Company standard", statusLabel: "design default" },
  { recordType: "inspection_run", keepMonths: 36, action: "keep", legalBasis: "IS 3696 / company standard", statusLabel: "design default" },
  { recordType: "media", keepMonths: 36, action: "erase", legalBasis: "DPDP s.8(7)", statusLabel: "design default" },
  { recordType: "audit_log", keepMonths: 12, action: "keep", legalBasis: "DPDP Rules r.6 (logs ≥ 1 year)", statusLabel: "verified_primary" },
  { recordType: "notification", keepMonths: 6, action: "erase", legalBasis: "Company standard", statusLabel: "design default" },
  { recordType: "reporter_identity", keepMonths: 12, action: "erase", legalBasis: "DPDP s.8(7)", statusLabel: "design default" },
];

export default function Retention() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { sites, siteName } = useScope();
  const policies = useLoad(() => api.get("/admin/retention-policies").then((r) => { const l = asList<RetentionPolicy>(r); return l.length ? l : DEFAULT_POLICIES; }), []);
  const holds = useLoad(() => api.get("/admin/legal-holds").then((r) => asList<LegalHold>(r)), []);
  const [rows, setRows] = useState<RetentionPolicy[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dry, setDry] = useState<RetentionDryRun | null>(null);
  const [newHold, setNewHold] = useState(false);
  useEffect(() => { if (policies.data) { setRows(policies.data); setDirty(false); } }, [policies.data]);
  const canEdit = perms.isAdmin && !perms.readOnly;
  const set = (i: number, patch: Partial<RetentionPolicy>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, statusLabel: r.statusLabel === "design default" && !("statusLabel" in patch) ? "company standard" : (patch.statusLabel ?? r.statusLabel) } : r))); setDirty(true); };
  return (
    <>
      <PageHead title={t("nav.retention")} sub={t("ret.sub")} tools={<>
        <ExportButton onExport={async () => localCsv(rows.map((r) => ({ record_type: r.recordType, keep_months: r.keepMonths, action: r.action, legal_basis: r.legalBasis, status: r.statusLabel })), "retention-policies.csv")} />
        {canEdit ? <AsyncButton size="sm" variant="primary" onClick={async () => { setDry(await api.post<RetentionDryRun>("/admin/retention/dry-run")); toast.success(t("ret.dryRunDone")); }}><IconPlay size={14} />{t("ret.dryRun")}</AsyncButton> : null}
      </>} />
      <div className="hint-box" style={{ marginBottom: 14 }}>{t("ret.noDeleteNote")}</div>
      {dry ? (
        <Card className="dry-run" style={{ marginBottom: 14 }}>
          <CardHead title={t("ret.dryRunTitle")} kicker={fmtDateTime(dry.ranAt, lang)} action={<Button size="sm" variant="ghost" onClick={() => setDry(null)}>{t("common.close")}</Button>} />
          <div className="table-wrap"><table className="table"><thead><tr><th>{t("ret.recordType")}</th><th className="num">{t("ret.wouldErase")}</th><th className="num">{t("ret.wouldAnonymise")}</th><th className="num">{t("ret.held")}</th></tr></thead>
            <tbody>{dry.rows.map((r) => <tr key={r.recordType}><td>{r.recordType}</td><td className="num">{r.erase}</td><td className="num">{r.anonymise}</td><td className="num">{r.held}</td></tr>)}</tbody></table></div>
        </Card>
      ) : null}
      <div className="two-col">
        <Card>
          <CardHead title={t("ret.policies")} kicker={t("status.tagHint")} />
          {policies.error && !policies.data ? <ErrorCard error={policies.error} onRetry={policies.reload} /> : null}
          {!policies.data ? <Skeleton lines={6} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t("ret.recordType")}</th><th>{t("ret.keepMonths")}</th><th>{t("ret.action")}</th><th>{t("ret.basis")}</th><th>{t("status.label")}</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.recordType} className="inline-edit">
                      <td className="cell-title">{r.recordType}</td>
                      <td style={{ width: 90 }}><Input type="number" min={1} max={240} value={r.keepMonths} onChange={(e) => set(i, { keepMonths: Number(e.target.value) })} disabled={!canEdit} aria-label={t("ret.keepMonths")} /></td>
                      <td style={{ width: 130 }}><Select value={r.action} onChange={(e) => set(i, { action: e.target.value as RetentionPolicy["action"] })} disabled={!canEdit} aria-label={t("ret.action")}><option value="erase">{t("ret.action.erase")}</option><option value="anonymise">{t("ret.action.anonymise")}</option><option value="keep">{t("ret.action.keep")}</option></Select></td>
                      <td><Input value={r.legalBasis} onChange={(e) => set(i, { legalBasis: e.target.value })} disabled={!canEdit} aria-label={t("ret.basis")} /></td>
                      <td><StatusTag label={r.statusLabel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canEdit ? <div className="btn-group" style={{ marginTop: 10 }}><Button variant="primary" disabled={!dirty} loading={busy} onClick={async () => { setBusy(true); try { const saved = await api.put("/admin/retention-policies", rows); const l = asList<RetentionPolicy>(saved); if (l.length) setRows(l); setDirty(false); toast.success(t("common.saved")); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); } }}>{t("common.save")}</Button></div> : null}
        </Card>
        <Card>
          <CardHead title={t("ret.holds")} kicker={t("ret.holdsKicker")} action={canEdit ? <Button size="sm" onClick={() => setNewHold(true)}><IconPlus size={14} />{t("ret.newHold")}</Button> : undefined} />
          {holds.error && !holds.data ? <ErrorCard error={holds.error} onRetry={holds.reload} /> : null}
          {!holds.data && !holds.error ? <Skeleton lines={4} /> : null}
          {holds.data && holds.data.length === 0 ? <EmptyState icon={<IconHistory />} title={t("ret.noHolds")} body={t("ret.noHoldsHint")} /> : null}
          {holds.data?.length ? (
            <div className="list-compact">
              {holds.data.map((h) => (
                <div className="li" key={h.id}>
                  <div className="sp"><strong>{h.recordType}</strong>{h.recordId ? <span className="mono-sm"> · {h.recordId.slice(0, 8)}…</span> : h.siteId ? ` · ${siteName(h.siteId)}` : ` · ${t("ret.allRecords")}`}<div className="small muted">{h.reason} · {h.createdByName} · {fmtDateTime(h.createdAt, lang)}</div></div>
                  {h.releasedAt ? <Pill tone="grey">{t("ret.released")}</Pill> : canEdit ? <AsyncButton size="sm" variant="ghost" onClick={async () => { await api.post(`/admin/legal-holds/${h.id}/release`); holds.reload(); toast.success(t("ret.releasedDone")); }}>{t("ret.release")}</AsyncButton> : <Pill tone="amber">{t("ret.active")}</Pill>}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
      {newHold ? <HoldSheet recordTypes={rows.map((r) => r.recordType)} sites={sites.map((s) => ({ id: s.id, label: s.code }))} onClose={() => setNewHold(false)} onSaved={() => { setNewHold(false); holds.reload(); toast.success(t("ret.holdCreated")); }} /> : null}
    </>
  );
}

function HoldSheet({ recordTypes, sites, onClose, onSaved }: { recordTypes: string[]; sites: { id: string; label: string }[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ recordType: recordTypes[0] ?? "observation", recordId: "", siteId: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Sheet title={t("ret.newHold")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={f.reason.trim().length < 3} loading={busy} onClick={async () => { setBusy(true); setErr(""); try { await api.post("/admin/legal-holds", { recordType: f.recordType, recordId: f.recordId || null, siteId: f.siteId || null, reason: f.reason.trim() }); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("ret.placeHold")}</Button></>}>
      <p className="small muted">{t("ret.holdBody")}</p>
      <Field label={t("ret.recordType")}><Select value={f.recordType} onChange={(e) => setF({ ...f, recordType: e.target.value })}>{recordTypes.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
      <Field label={t("ret.recordId")} optional hint={t("ret.recordIdHint")}><Input value={f.recordId} onChange={(e) => setF({ ...f, recordId: e.target.value })} className="mono-sm" /></Field>
      <Field label={t("common.site")} optional><Select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}><option value="">{t("ret.allRecords")}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
      <Field label={t("common.reason")} required><Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} /></Field>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
