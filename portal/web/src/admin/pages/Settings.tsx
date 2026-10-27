/* Organisation settings: name / legal name / address / phone, MFA-required roles, SLAs, quiet hours, caps, duplicate window, languages, photo quality. */
import { useEffect, useState } from "react";
import { useI18n, LANGS, LANG_NAMES } from "../../shared/i18n";
import type { Lang, Role } from "../../shared/types";
import { Button, Card, CardHead, ErrorCard, Field, Form, Input, Select, Skeleton, Textarea, useToast } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { api, errMessage } from "../api";
import { useAuth } from "../auth";
import type { OrgSettingsAdmin } from "../types";
import { ChipsSelect, PageHead, StatusTag } from "../components";

const MFA_ROLES: Role[] = ["admin", "hse_manager", "site_head", "site_safety_officer", "auditor", "verifier", "action_owner"];

export default function Settings() {
  const { t } = useI18n();
  const toast = useToast();
  const { perms, me, refreshMe } = useAuth();
  const state = useLoad(() => api.get<OrgSettingsAdmin>("/admin/settings"), []);
  const [f, setF] = useState<OrgSettingsAdmin | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (state.data) setF({ ...state.data, orgName: state.data.orgName ?? me?.org.name ?? "", legalName: state.data.legalName ?? "", address: state.data.address ?? "", phone: state.data.phone ?? "" }); }, [state.data, me]);
  const canEdit = perms.isAdmin && !perms.readOnly;
  if (state.error && !state.data) return <><PageHead title={t("nav.settings")} /><ErrorCard error={state.error} onRetry={state.reload} /></>;
  if (!f) return <><PageHead title={t("nav.settings")} /><Skeleton lines={10} /></>;
  const label = (k: string) => <StatusTag label={f.statusLabels?.[k] ?? "design default"} />;
  const num = (k: keyof OrgSettingsAdmin, min: number, max: number) => <Input type="number" min={min} max={max} value={f[k] as number} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} disabled={!canEdit} />;
  const problems: string[] = [];
  if (!f.orgName.trim()) problems.push(t("settings.orgNameRequired"));
  if (!f.languages.includes(f.defaultLanguage)) problems.push(t("settings.defaultLangInList"));
  if (f.photoQuality < 0.3 || f.photoQuality > 1) problems.push(t("settings.photoQualityRange"));
  return (
    <Form onSubmit={async () => {
      if (problems.length) { setErr(problems[0]); return; }
      setBusy(true); setErr("");
      try { const saved = await api.put<OrgSettingsAdmin>("/admin/settings", f); setF({ ...f, ...saved }); await refreshMe(); toast.success(t("common.saved")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>
      <PageHead title={t("nav.settings")} sub={t("settings.sub")} />
      <div className="two-col">
        <Card>
          <CardHead title={t("settings.org")} />
          <Field label={t("settings.orgName")} required><Input value={f.orgName} onChange={(e) => setF({ ...f, orgName: e.target.value })} disabled={!canEdit} maxLength={120} /></Field>
          <Field label={t("settings.legalName")} hint={t("settings.legalNameHint")}><Input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} disabled={!canEdit} maxLength={160} /></Field>
          <Field label={t("sites.address")}><Textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} disabled={!canEdit} maxLength={300} /></Field>
          <Field label={t("users.phone")} hint={t("settings.phoneHint")}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={!canEdit} inputMode="tel" maxLength={20} /></Field>
        </Card>
        <Card>
          <CardHead title={t("settings.security")} />
          <Field label={t("settings.mfaRoles")} hint={<span className="row" style={{ gap: 6 }}>{t("settings.mfaRolesHint")} {label("mfa_required_roles")}</span>}>
            <ChipsSelect ariaLabel={t("settings.mfaRoles")} options={MFA_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} value={f.mfaRequiredRoles} onChange={(v) => canEdit && setF({ ...f, mfaRequiredRoles: v })} />
          </Field>
          <Field label={t("settings.languages")} hint={t("settings.languagesHint")}>
            <ChipsSelect ariaLabel={t("settings.languages")} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} value={f.languages} onChange={(v) => canEdit && setF({ ...f, languages: LANGS.filter((l) => v.includes(l) || l === "en") })} />
          </Field>
          <Field label={t("settings.defaultLanguage")}><Select value={f.defaultLanguage} onChange={(e) => setF({ ...f, defaultLanguage: e.target.value as Lang })} disabled={!canEdit}>{f.languages.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</Select></Field>
        </Card>
        <Card>
          <CardHead title={t("settings.slas")} kicker={t("status.tagHint")} />
          <div className="form-grid">
            <Field label={t("settings.triageSla")} hint={label("triage_sla")}>{num("triageSlaWorkingDays", 1, 10)}</Field>
            <Field label={t("settings.triageEscalate")} hint={label("triage_escalate")}>{num("triageEscalateWorkingDays", 1, 15)}</Field>
            <Field label={t("settings.criticalAck")} hint={label("critical_ack")}>{num("criticalAckMinutes", 5, 240)}</Field>
            <Field label={t("settings.dateChangeBeforeHead")} hint={label("date_change_requests")}>{num("dateChangeRequestsBeforeSiteHead", 1, 10)}</Field>
            <Field label={t("settings.disputePause")} hint={label("dispute_pause")}>{num("disputePauseDays", 0, 14)}</Field>
          </div>
        </Card>
        <Card>
          <CardHead title={t("settings.notifications")} />
          <div className="form-grid">
            <Field label={t("settings.quietStart")} hint={label("quiet_hours")}><Input type="time" value={f.quietHours.start} onChange={(e) => setF({ ...f, quietHours: { ...f.quietHours, start: e.target.value } })} disabled={!canEdit} /></Field>
            <Field label={t("settings.quietEnd")}><Input type="time" value={f.quietHours.end} onChange={(e) => setF({ ...f, quietHours: { ...f.quietHours, end: e.target.value } })} disabled={!canEdit} /></Field>
            <Field label={t("settings.dailyPushCap")} hint={<span className="row" style={{ gap: 6 }}>{t("settings.dailyPushCapHint")} {label("daily_push_cap")}</span>}>{num("dailyPushCap", 1, 50)}</Field>
          </div>
        </Card>
        <Card>
          <CardHead title={t("settings.duplicates")} />
          <div className="form-grid">
            <Field label={t("settings.dupWindow")} hint={label("duplicate_window")}>{num("duplicateWindowHours", 1, 168)}</Field>
            <Field label={t("settings.dupRadius")} hint={label("duplicate_radius")}>{num("duplicateRadiusM", 5, 500)}</Field>
          </div>
        </Card>
        <Card>
          <CardHead title={t("settings.photos")} />
          <div className="form-grid">
            <Field label={t("settings.photoEdge")} hint={label("photo_max_edge")}>{num("photoMaxEdgePx", 800, 4000)}</Field>
            <Field label={t("settings.photoQuality")} hint={t("settings.photoQualityHint")}><Input type="number" min={0.3} max={1} step={0.05} value={f.photoQuality} onChange={(e) => setF({ ...f, photoQuality: Number(e.target.value) })} disabled={!canEdit} /></Field>
          </div>
        </Card>
      </div>
      {problems.length ? <div className="field invalid" style={{ marginTop: 10 }}>{problems.map((p, i) => <div className="error" key={i}>{p}</div>)}</div> : null}
      {err ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{err}</p></div> : null}
      {canEdit ? <div className="sticky-foot"><Button type="submit" variant="primary" loading={busy} disabled={problems.length > 0}>{t("common.save")}</Button></div> : null}
    </Form>
  );
}
