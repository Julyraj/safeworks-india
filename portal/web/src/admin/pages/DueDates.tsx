/* Due-date rules per band (company default + per-site overrides) and reminder ladders (steps: offset, recipient, channel; daily cap), with status labels. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { Band, DueDateRule, ReminderLadder } from "../../shared/types";
import { BandPill, Button, Card, CardHead, ErrorCard, Field, Input, Select, Skeleton, Tabs, Toggle, useToast } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { IconPlus, IconTrash } from "../../shared/icons";
import { DEFAULT_DUE_RULES } from "../../shared/risk";
import { uuid } from "../../shared/storage";
import { api, asList, errMessage } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { PageHead, StatusTag } from "../components";

const BANDS: Band[] = ["extreme", "high", "moderate", "low"];
const RECIPIENTS: ReminderLadder["steps"][number]["recipient"][] = ["owner", "verifier", "site_safety_officer", "site_head", "hse_manager"];
const DEFAULT_LADDERS: ReminderLadder[] = [
  { id: "l-extreme", band: "extreme", steps: [{ offsetMinutes: -1440, recipient: "owner", channel: "push" }, { offsetMinutes: -240, recipient: "owner", channel: "push" }, { offsetMinutes: 0, recipient: "owner", channel: "both" }, { offsetMinutes: 120, recipient: "site_safety_officer", channel: "both" }, { offsetMinutes: 120, recipient: "site_head", channel: "both" }, { offsetMinutes: 1440, recipient: "hse_manager", channel: "both" }], dailyCap: 5, statusLabel: "design default" },
  ...(["high", "moderate", "low"] as Band[]).map((band) => ({ id: `l-${band}`, band, steps: [{ offsetMinutes: -10080, recipient: "owner" as const, channel: "push" as const }, { offsetMinutes: -4320, recipient: "owner" as const, channel: "push" as const }, { offsetMinutes: 0, recipient: "owner" as const, channel: "both" as const }, { offsetMinutes: 1440, recipient: "site_safety_officer" as const, channel: "both" as const }, { offsetMinutes: 1440, recipient: "site_head" as const, channel: "both" as const }, { offsetMinutes: 4320, recipient: "hse_manager" as const, channel: "both" as const }], dailyCap: 5, statusLabel: "design default" })),
];

function offsetText(min: number, t: (k: string, v?: Record<string, string | number>) => string) {
  const abs = Math.abs(min);
  const span = abs % 1440 === 0 ? t("common.days", { count: abs / 1440 }) : abs % 60 === 0 ? t("common.hours", { count: abs / 60 }) : `${abs} min`;
  return min === 0 ? t("due.atDue") : min < 0 ? t("due.before", { span }) : t("due.after", { span });
}

export default function DueDates() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"rules" | "ladders">("rules");
  return (
    <>
      <PageHead title={t("nav.dueDates")} sub={t("due.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "rules", label: t("due.rulesTab") }, { value: "ladders", label: t("due.laddersTab") }]} />
      <div style={{ marginTop: 14 }}>{tab === "rules" ? <RulesTab /> : <LaddersTab />}</div>
    </>
  );
}

function RulesTab() {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { sites, reload } = useScope();
  const state = useLoad(() => api.get("/admin/due-date-rules").then((r) => { const l = asList<DueDateRule>(r); return l.length ? l : DEFAULT_DUE_RULES; }), []);
  const [rules, setRules] = useState<DueDateRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newSite, setNewSite] = useState("");
  useEffect(() => { if (state.data) setRules(state.data); }, [state.data]);
  const canEdit = perms.isHse && !perms.readOnly;
  const siteIds = [null, ...Array.from(new Set(rules.filter((r) => r.siteId).map((r) => r.siteId as string)))];
  const set = (id: string, patch: Partial<DueDateRule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, statusLabel: r.statusLabel === "design default" && Object.keys(patch).some((k) => k !== "statusLabel") ? "company standard" : r.statusLabel } : r)));
  const addOverride = () => {
    if (!newSite || rules.some((r) => r.siteId === newSite)) return;
    setRules((rs) => [...rs, ...BANDS.map((b) => { const base = rs.find((r) => r.band === b && r.siteId === null) ?? DEFAULT_DUE_RULES.find((r) => r.band === b)!; return { ...base, id: uuid(), siteId: newSite, statusLabel: "company standard" }; })]);
    setNewSite("");
  };
  if (state.error && !state.data) return <ErrorCard error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Skeleton lines={6} />;
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{t("due.rulesHint")}</p>
      {siteIds.map((sid) => (
        <Card key={sid ?? "default"}>
          <CardHead title={sid ? pick(sites.find((s) => s.id === sid)?.name) || sid : t("due.companyDefault")} kicker={sid ? t("due.override") : t("due.appliesEverywhere")}
            action={sid && canEdit ? <Button size="sm" variant="ghost" onClick={() => setRules((rs) => rs.filter((r) => r.siteId !== sid))}><IconTrash size={14} />{t("due.removeOverride")}</Button> : undefined} />
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t("common.risk")}</th><th>{t("due.dueIn")}</th><th>{t("due.unit")}</th><th>{t("triage.interimControl")}</th><th>{t("due.verifyWithin")}</th><th>{t("status.label")}</th></tr></thead>
              <tbody>
                {BANDS.map((b) => { const r = rules.find((x) => x.band === b && x.siteId === sid); if (!r) return null; return (
                  <tr key={r.id} className="inline-edit">
                    <td><BandPill band={b} /></td>
                    <td style={{ width: 110 }}><Input type="number" min={1} value={r.dueAmount} onChange={(e) => set(r.id, { dueAmount: Number(e.target.value) })} disabled={!canEdit} aria-label={t("due.dueIn")} /></td>
                    <td style={{ width: 150 }}><Select value={r.dueUnit} onChange={(e) => set(r.id, { dueUnit: e.target.value as DueDateRule["dueUnit"] })} disabled={!canEdit} aria-label={t("due.unit")}><option value="hours">{t("due.unit.hours")}</option><option value="days">{t("due.unit.days")}</option><option value="working_days">{t("due.unit.working_days")}</option></Select></td>
                    <td><Toggle label={<span className="small">{r.interimControlRequired ? t("common.required") : t("due.notRequired")}</span>} checked={r.interimControlRequired} onChange={(v) => set(r.id, { interimControlRequired: v })} disabled={!canEdit} /></td>
                    <td style={{ width: 130 }}><div className="input-row"><Input type="number" min={1} value={r.verifyWithinHours} onChange={(e) => set(r.id, { verifyWithinHours: Number(e.target.value) })} disabled={!canEdit} aria-label={t("due.verifyWithin")} /><span className="small muted" style={{ alignSelf: "center" }}>h</span></div></td>
                    <td><StatusTag label={r.statusLabel} />{canEdit ? <Input value={r.statusLabel} onChange={(e) => set(r.id, { statusLabel: e.target.value })} style={{ marginTop: 4 }} aria-label={t("status.label")} /> : null}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {canEdit ? (
        <div className="row">
          <Select value={newSite} onChange={(e) => setNewSite(e.target.value)} style={{ width: "auto", minWidth: 220 }} aria-label={t("due.addOverride")}>
            <option value="">{t("due.addOverride")}</option>
            {sites.filter((s) => !siteIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.code} · {pick(s.name)}</option>)}
          </Select>
          <Button size="sm" onClick={addOverride} disabled={!newSite}><IconPlus size={14} />{t("common.add")}</Button>
        </div>
      ) : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
      {canEdit ? <div className="sticky-foot"><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setErr(""); try { const saved = await api.put("/admin/due-date-rules", rules); const l = asList<DueDateRule>(saved); if (l.length) setRules(l); await reload("dueRules"); toast.success(t("common.saved")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("common.save")}</Button></div> : null}
    </div>
  );
}

function LaddersTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const state = useLoad(() => api.get("/admin/ladders").then((r) => { const l = asList<ReminderLadder>(r); return l.length ? l : DEFAULT_LADDERS; }), []);
  const [ladders, setLadders] = useState<ReminderLadder[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (state.data) setLadders(state.data); }, [state.data]);
  const canEdit = perms.isHse && !perms.readOnly;
  const set = (id: string, fn: (l: ReminderLadder) => ReminderLadder) => setLadders((ls) => ls.map((l) => (l.id === id ? { ...fn(l), statusLabel: l.statusLabel === "design default" ? "company standard" : l.statusLabel } : l)));
  if (state.error && !state.data) return <ErrorCard error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Skeleton lines={6} />;
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{t("due.laddersHint")}</p>
      <div className="two-col">
        {BANDS.map((b) => { const l = ladders.find((x) => x.band === b); if (!l) return null; return (
          <Card key={l.id}>
            <CardHead title={<span className="row"><BandPill band={b} />{t("due.ladderFor")}</span>} kicker={<StatusTag label={l.statusLabel} />} />
            <div className="steps-editor">
              {[...l.steps].map((s, i) => (
                <div className="se" key={i}>
                  <div className="input-row"><Input type="number" step={60} value={s.offsetMinutes} onChange={(e) => set(l.id, (x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? { ...y, offsetMinutes: Number(e.target.value) } : y)) }))} disabled={!canEdit} aria-label={t("due.offset")} title={offsetText(s.offsetMinutes, t)} /></div>
                  <Select value={s.recipient} onChange={(e) => set(l.id, (x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? { ...y, recipient: e.target.value as typeof s.recipient } : y)) }))} disabled={!canEdit} aria-label={t("due.recipient")}>{RECIPIENTS.map((r) => <option key={r} value={r}>{r === "owner" ? t("common.owner") : r === "verifier" ? t("common.verifier") : t(`role.${r}`)}</option>)}</Select>
                  <Select value={s.channel} onChange={(e) => set(l.id, (x) => ({ ...x, steps: x.steps.map((y, j) => (j === i ? { ...y, channel: e.target.value as typeof s.channel } : y)) }))} disabled={!canEdit} aria-label={t("due.channel")}><option value="push">{t("due.channel.push")}</option><option value="email">{t("due.channel.email")}</option><option value="both">{t("due.channel.both")}</option></Select>
                  {canEdit ? <Button size="sm" variant="ghost" icon onClick={() => set(l.id, (x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }))} aria-label={t("common.remove")}><IconTrash size={14} /></Button> : <span />}
                  <div className="small muted" style={{ gridColumn: "1 / -1" }}>{offsetText(s.offsetMinutes, t)} → {s.recipient === "owner" ? t("common.owner") : s.recipient === "verifier" ? t("common.verifier") : t(`role.${s.recipient}`)}</div>
                </div>
              ))}
            </div>
            <div className="row between" style={{ marginTop: 10 }}>
              {canEdit ? <Button size="sm" onClick={() => set(l.id, (x) => ({ ...x, steps: [...x.steps, { offsetMinutes: 0, recipient: "owner", channel: "push" }] }))}><IconPlus size={14} />{t("due.addStep")}</Button> : <span />}
              <Field label={t("due.dailyCap")} hint={t("due.dailyCapHint")}><Input type="number" min={1} max={50} value={l.dailyCap} onChange={(e) => set(l.id, (x) => ({ ...x, dailyCap: Number(e.target.value) }))} disabled={!canEdit} style={{ width: 90 }} /></Field>
            </div>
          </Card>
        ); })}
      </div>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
      {canEdit ? <div className="sticky-foot"><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setErr(""); try { const saved = await api.put("/admin/ladders", ladders); const l = asList<ReminderLadder>(saved); if (l.length) setLadders(l); toast.success(t("common.saved")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("common.save")}</Button></div> : null}
    </div>
  );
}
