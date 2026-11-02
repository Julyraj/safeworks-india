/* Retention: policies table (keep years, end action, basis note, status label), legal holds (place / release), dry-run report.
   Nothing is deleted in 2.0: the dry run only counts what would be erased or anonymised. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Button, Card, CardHead, EmptyState, ErrorCard, Field, Input, Pill, Select, Sheet, Skeleton, Textarea, useToast } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDateTime } from "../../shared/format";
import { IconHistory, IconPlus, IconPlay } from "../../shared/icons";
import { api, asList, errMessage, localCsv } from "../api";
import { useAuth } from "../auth";
import type { LegalHold, RetentionDryRun, RetentionPolicy } from "../types";
import { AsyncButton, ExportButton, PageHead, StatusTag } from "../components";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Retention() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const policies = useLoad(() => api.get("/admin/retention-policies").then((r) => asList<RetentionPolicy>(r)), []);
  const holds = useLoad(() => api.get("/admin/legal-holds").then((r) => asList<LegalHold>(r)), []);
  const [rows, setRows] = useState<RetentionPolicy[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dry, setDry] = useState<RetentionDryRun | null>(null);
  const [newHold, setNewHold] = useState(false);
  useEffect(() => { if (policies.data) { setRows(policies.data); setDirty(false); } }, [policies.data]);
  const canEdit = perms.isAdmin && !perms.readOnly;
  const set = (i: number, patch: Partial<RetentionPolicy>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, statusLabel: r.statusLabel === "design default" ? "company standard" : r.statusLabel } : r))); setDirty(true); };
  const valid = rows.every((r) => Number.isInteger(r.retentionYears) && r.retentionYears >= 1 && r.retentionYears <= 50);
  return (
    <>
      <PageHead title={t("nav.retention")} sub={t("ret.sub")} tools={<>
        <ExportButton onExport={async () => localCsv(rows.map((r) => ({ record_type: r.recordType, keep_years: r.retentionYears, end_action: r.endAction, basis: r.basisNote, status: r.statusLabel })), "retention-policies.csv")} />
        {canEdit ? <AsyncButton size="sm" variant="primary" onClick={async () => { setDry(await api.post<RetentionDryRun>("/admin/retention/dry-run")); toast.success(t("ret.dryRunDone")); }}><IconPlay size={14} />{t("ret.dryRun")}</AsyncButton> : null}
      </>} />
      <div className="hint-box" style={{ marginBottom: 14 }}>{t("ret.noDeleteNote")}</div>
      {dry ? (
        <Card className="dry-run" style={{ marginBottom: 14 }}>
          <CardHead title={t("ret.dryRunTitle")} kicker={`${fmtDateTime(dry.checkedAt, lang)} · ${t("ret.holdsN", { n: dry.legalHolds })}`} action={<Button size="sm" variant="ghost" onClick={() => setDry(null)}>{t("common.close")}</Button>} />
          <div className="table-wrap"><table className="table"><thead><tr><th>{t("ret.recordType")}</th><th>{t("ret.keepYears")}</th><th>{t("ret.action")}</th><th className="num">{t("ret.candidates")}</th><th>{t("ret.held")}</th></tr></thead>
            <tbody>{Object.entries(dry.byRecordType).map(([rt, r]) => <tr key={rt}><td>{rt}</td><td className="num">{r.retentionYears}</td><td>{t(`ret.action.${r.endAction}`)}</td><td className="num">{r.candidates}</td><td>{r.legalHold ? <Pill tone="amber">{t("ret.active")}</Pill> : "—"}</td></tr>)}</tbody></table></div>
        </Card>
      ) : null}
      <div className="two-col">
        <Card>
          <CardHead title={t("ret.policies")} kicker={t("status.tagHint")} />
          {policies.error && !policies.data ? <ErrorCard error={policies.error} onRetry={policies.reload} /> : null}
          {!policies.data && !policies.error ? <Skeleton lines={6} /> : null}
          {policies.data && rows.length === 0 ? <EmptyState icon={<IconHistory />} title={t("ret.noPolicies")} body={t("ret.noPoliciesHint")} /> : null}
          {rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t("ret.recordType")}</th><th>{t("ret.keepYears")}</th><th>{t("ret.action")}</th><th>{t("ret.basis")}</th><th>{t("status.label")}</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.recordType} className="inline-edit">
                      <td className="cell-title">{r.recordType}</td>
                      <td style={{ width: 90 }}><Input type="number" min={1} max={50} value={r.retentionYears} onChange={(e) => set(i, { retentionYears: Number(e.target.value) })} disabled={!canEdit} aria-label={t("ret.keepYears")} /></td>
                      <td style={{ width: 130 }}><Select value={r.endAction} onChange={(e) => set(i, { endAction: e.target.value as RetentionPolicy["endAction"] })} disabled={!canEdit} aria-label={t("ret.action")}><option value="erase">{t("ret.action.erase")}</option><option value="anonymise">{t("ret.action.anonymise")}</option></Select></td>
                      <td><Input value={r.basisNote} onChange={(e) => set(i, { basisNote: e.target.value })} disabled={!canEdit} aria-label={t("ret.basis")} maxLength={500} /></td>
                      <td><StatusTag label={r.statusLabel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {canEdit && rows.length ? <div className="btn-group" style={{ marginTop: 10 }}><Button variant="primary" disabled={!dirty || !valid} loading={busy} onClick={async () => { setBusy(true); try { const saved = asList<RetentionPolicy>(await api.put("/admin/retention-policies", rows)); setRows(saved); setDirty(false); toast.success(t("common.saved")); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); } }}>{t("common.save")}</Button></div> : null}
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
                  <div className="sp"><strong>{h.scopeType}</strong>{h.scopeId ? <span className="mono-sm"> · {h.scopeId.slice(0, 8)}…</span> : ` · ${t("ret.allRecords")}`}<div className="small muted">{h.reason} · {h.placedByName ?? "—"} · {fmtDateTime(h.placedAt, lang)}</div></div>
                  {h.releasedAt ? <Pill tone="grey">{t("ret.released")}</Pill> : canEdit ? <AsyncButton size="sm" variant="ghost" onClick={async () => { holds.setData(asList<LegalHold>(await api.post(`/admin/legal-holds/${h.id}/release`))); toast.success(t("ret.releasedDone")); }}>{t("ret.release")}</AsyncButton> : <Pill tone="amber">{t("ret.active")}</Pill>}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
      {newHold ? <HoldSheet recordTypes={rows.map((r) => r.recordType)} onClose={() => setNewHold(false)} onSaved={(list) => { setNewHold(false); holds.setData(list); toast.success(t("ret.holdCreated")); }} /> : null}
    </>
  );
}

function HoldSheet({ recordTypes, onClose, onSaved }: { recordTypes: string[]; onClose: () => void; onSaved: (list: LegalHold[]) => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ scopeType: recordTypes[0] ?? "observation", scopeId: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const idBad = !!f.scopeId.trim() && !UUID.test(f.scopeId.trim());
  return (
    <Sheet title={t("ret.newHold")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={f.reason.trim().length < 3 || idBad} loading={busy} onClick={async () => { setBusy(true); setErr(""); try { onSaved(asList<LegalHold>(await api.post("/admin/legal-holds", { scopeType: f.scopeType, scopeId: f.scopeId.trim() || null, reason: f.reason.trim() }))); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("ret.placeHold")}</Button></>}>
      <p className="small muted">{t("ret.holdBody")}</p>
      <Field label={t("ret.recordType")}><Select value={f.scopeType} onChange={(e) => setF({ ...f, scopeType: e.target.value })}>{recordTypes.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
      <Field label={t("ret.recordId")} optional hint={t("ret.recordIdHint")} error={idBad ? t("ret.recordIdBad") : undefined}><Input value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })} className="mono-sm" /></Field>
      <Field label={t("common.reason")} required><Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={2000} /></Field>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
