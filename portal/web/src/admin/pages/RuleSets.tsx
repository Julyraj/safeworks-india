/* Statutory rule sets: list with regime/status badges, timer rules table, enable with a named reviewer (the server refuses drafts and
   timers without a deadline — the message is shown), disable, assign to a site with an effective date. */
import { useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { RuleSet } from "../../shared/types";
import { Button, Card, CardHead, EmptyState, ErrorCard, Field, Input, Pill, Select, Sheet, Skeleton, useToast } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDate } from "../../shared/format";
import { IconBook, IconCheck, IconSite } from "../../shared/icons";
import { api, asList, errMessage, localCsv } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { Drawer, ExportButton, KV, PageHead, StatusTag } from "../components";

export default function RuleSets() {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { sites, reloadSites } = useScope();
  const state = useLoad(() => api.get("/admin/rule-sets").then((r) => asList<RuleSet>(r)), []);
  const [sel, setSel] = useState<RuleSet | null>(null);
  const [enable, setEnable] = useState<RuleSet | null>(null);
  const [assign, setAssign] = useState<RuleSet | null>(null);
  const canEdit = perms.isHse && !perms.readOnly;
  const canAssign = (perms.isAdmin || perms.isHse) && !perms.readOnly;
  const patch = (r: RuleSet) => { state.setData((state.data ?? []).map((x) => (x.code === r.code ? r : x))); if (sel?.code === r.code) setSel(r); };
  const list = state.data ?? [];
  const usedBy = (code: string) => sites.filter((s) => s.ruleSetCode === code);
  return (
    <>
      <PageHead title={t("nav.ruleSets")} sub={t("rules.sub")} tools={<ExportButton onExport={async () => localCsv(list.map((r) => ({ code: r.code, name: r.name, state: r.state, site_type: r.siteType, regime: r.regime, status: r.status, enabled: r.enabled, version: r.version, reviewed_by: r.reviewedBy, reviewed_at: r.reviewedAt ?? "", timers: r.timerRules.length })), "rule-sets.csv")} />} />
      <div className="banner info" style={{ marginBottom: 12 }}><IconBook size={16} />{t("rules.disclaimer")}</div>
      {state.error && !state.data ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!state.data && !state.error ? <Skeleton lines={8} /> : null}
      {state.data && list.length === 0 ? <EmptyState title={t("rules.empty")} body={t("rules.emptyHint")} /> : null}
      {list.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t("rules.code")}</th><th>{t("rules.name")}</th><th>{t("rules.regime")}</th><th>{t("common.status")}</th><th>{t("rules.timers")}</th><th>{t("rules.reviewed")}</th><th>{t("rules.usedBy")}</th><th /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.code} className="clickable" tabIndex={0} onClick={() => setSel(r)} onKeyDown={(e) => { if (e.key === "Enter") setSel(r); }}>
                  <td><span className="case">{r.code}</span><div className="cell-sub">v{r.version}</div></td>
                  <td><div className="cell-title">{r.name}</div><div className="cell-sub">{r.state} · {r.siteType}</div></td>
                  <td><Pill tone={r.regime === "draft" ? "red" : r.regime === "legacy" ? "grey" : "blue"}>{t(`rules.regime.${r.regime}`)}</Pill></td>
                  <td><div className="row" style={{ gap: 4 }}><StatusTag label={r.status} /><Pill tone={r.enabled ? "green" : "grey"}>{r.enabled ? t("rules.enabled") : t("rules.disabled")}</Pill></div></td>
                  <td className="num">{r.timerRules.length}{r.timerRules.some((x) => x.deadlineMinutes === null) ? <Pill tone="amber" title={t("rules.noDeadline")}>!</Pill> : null}</td>
                  <td className="small">{r.reviewedBy ? `${r.reviewedBy} · ${fmtDate(r.reviewedAt, lang)}` : <span className="muted">—</span>}</td>
                  <td className="small">{usedBy(r.code).map((s) => s.code).join(", ") || "—"}</td>
                  <td><span className="row-actions">
                    {canEdit && !r.enabled ? <Button size="sm" onClick={(e) => { e.stopPropagation(); setEnable(r); }} title={r.status === "draft_rule" ? t("rules.draftRefused") : undefined}>{t("rules.enable")}</Button> : null}
                    {canEdit && r.enabled ? <Button size="sm" variant="ghost" onClick={async (e) => { e.stopPropagation(); try { patch(await api.post<RuleSet>(`/admin/rule-sets/${r.code}/disable`)); toast.success(t("rules.disabledDone")); } catch (er) { toast.error(errMessage(er)); } }}>{t("rules.disable")}</Button> : null}
                    {canAssign && r.enabled ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setAssign(r); }}><IconSite size={14} />{t("rules.assign")}</Button> : null}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {sel ? (
        <Drawer title={sel.name} kicker={`${sel.code} · v${sel.version}`} onClose={() => setSel(null)} wide footer={<>
          {canEdit && !sel.enabled ? <Button variant="primary" onClick={() => setEnable(sel)}><IconCheck size={16} />{t("rules.enable")}</Button> : null}
          {canAssign && sel.enabled ? <Button onClick={() => setAssign(sel)}>{t("rules.assign")}</Button> : null}
          <span className="grow" /><Button variant="ghost" onClick={() => setSel(null)}>{t("common.close")}</Button>
        </>}>
          <div className="row" style={{ marginBottom: 12 }}><Pill tone={sel.regime === "draft" ? "red" : "blue"}>{t(`rules.regime.${sel.regime}`)}</Pill><StatusTag label={sel.status} /><Pill tone={sel.enabled ? "green" : "grey"}>{sel.enabled ? t("rules.enabled") : t("rules.disabled")}</Pill></div>
          <KV rows={[{ k: t("sites.state"), v: sel.state }, { k: t("sites.type"), v: sel.siteType }, { k: t("sites.effectiveFrom"), v: sel.effectiveFrom ? fmtDate(sel.effectiveFrom, lang) : "—" }, { k: t("rules.reviewed"), v: sel.reviewedBy ? `${sel.reviewedBy} · ${fmtDate(sel.reviewedAt, lang)}` : "—" }, { k: t("rules.usedBy"), v: usedBy(sel.code).map((s) => `${s.code} ${pick(s.name)}`).join(", ") || "—" }, { k: t("common.note"), v: sel.notes || "—" }]} />
          {sel.status === "draft_rule" ? <div className="banner warn" style={{ marginTop: 12 }}>{t("rules.draftRefused")}</div> : null}
          <div className="section-title">{t("rules.timers")} ({sel.timerRules.length})</div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t("rules.trigger")}</th><th>{t("rules.deadline")}</th><th>{t("rules.recipient")}</th><th>{t("rules.form")}</th><th>{t("common.status")}</th></tr></thead>
              <tbody>
                {sel.timerRules.map((tr) => (
                  <tr key={tr.id}>
                    <td><div className="cell-title">{tr.trigger.eventClass}</div>{tr.trigger.conditions?.length ? <div className="cell-sub">{tr.trigger.conditions.join("; ")}</div> : null}</td>
                    <td>{tr.deadlineMinutes === null ? <Pill tone="amber">{t("rules.noDeadline")}</Pill> : tr.deadlineMinutes % 1440 === 0 ? t("common.days", { count: tr.deadlineMinutes / 1440 }) : tr.deadlineMinutes % 60 === 0 ? t("common.hours", { count: tr.deadlineMinutes / 60 }) : `${tr.deadlineMinutes} min`}<div className="cell-sub">{t(`rules.basis.${tr.deadlineBasis}`)}</div></td>
                    <td>{tr.recipient}</td><td className="mono-sm">{tr.formCode || "—"}</td>
                    <td><StatusTag label={tr.status} />{tr.sourceNote ? <div className="cell-sub">{tr.sourceNote}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Drawer>
      ) : null}
      {enable ? <EnableSheet r={enable} onClose={() => setEnable(null)} onDone={(nr) => { patch(nr); setEnable(null); }} /> : null}
      {assign ? <AssignSheet r={assign} onClose={() => setAssign(null)} onDone={async () => { setAssign(null); await reloadSites(); }} /> : null}
    </>
  );
}

function EnableSheet({ r, onClose, onDone }: { r: RuleSet; onClose: () => void; onDone: (r: RuleSet) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { me } = useAuth();
  const [reviewer, setReviewer] = useState(me?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const draft = r.status === "draft_rule";
  const noDeadline = r.timerRules.filter((x) => x.deadlineMinutes === null);
  return (
    <Sheet title={`${t("rules.enable")} · ${r.code}`} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={reviewer.trim().length < 3} loading={busy} onClick={async () => { setBusy(true); setErr(""); try { onDone(await api.post<RuleSet>(`/admin/rule-sets/${r.code}/enable`, { reviewedBy: reviewer.trim() })); toast.success(t("rules.enabledDone")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("rules.enable")}</Button></>}>
      {draft ? <div className="banner warn" style={{ marginBottom: 10 }}>{t("rules.draftRefused")}</div> : null}
      {noDeadline.length ? <div className="banner warn" style={{ marginBottom: 10 }}>{t("rules.noDeadlineRefused", { n: noDeadline.length })}</div> : null}
      <p className="small">{t("rules.enableBody")}</p>
      <Field label={t("rules.reviewer")} required hint={t("rules.reviewerHint")}><Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} maxLength={100} autoFocus /></Field>
      {err ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

function AssignSheet({ r, onClose, onDone }: { r: RuleSet; onClose: () => void; onDone: () => Promise<void> }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { sites } = useScope();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Sheet title={`${t("rules.assign")} · ${r.code}`} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!siteId || !from} loading={busy} onClick={async () => { setBusy(true); setErr(""); try { await api.post(`/admin/sites/${siteId}/rule-set`, { code: r.code, effectiveFrom: from }); toast.success(t("rules.assigned")); await onDone(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("rules.assign")}</Button></>}>
      <Field label={t("common.site")} required><Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {pick(s.name)}{s.ruleSetCode ? ` (${s.ruleSetCode})` : ""}</option>)}</Select></Field>
      <Field label={t("sites.effectiveFrom")} required hint={t("sites.effectiveHint")}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Card flat><CardHead title={r.name} kicker={<StatusTag label={r.status} />} /><p className="small muted" style={{ margin: 0 }}>{t("rules.assignNote")}</p></Card>
      {err ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
