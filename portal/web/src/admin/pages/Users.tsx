/* Users & roles: register, create/edit sheet with roles per site (medical-data flag, auditor expiry), one-time secrets,
   reset password, enrolment code, unlock, suspend/deactivate (undoable), MFA reset, revoke devices, CSV import. */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { ImportResult, Lang, Me, Role, SiteRole, UserAdmin, UserCreate } from "../../shared/types";
import { Button, DataTable, EmptyState, ErrorCard, Field, Input, Pagination, Pill, SearchEmpty, Select, Sheet, Skeleton, Toggle, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDate, fmtDateTime, relative } from "../../shared/format";
import { IconKey, IconLock, IconPlus, IconShield, IconTrash, IconUsers } from "../../shared/icons";
import { api, dateInputValue, errMessage, localCsv } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { CountLine, CsvImport, Drawer, ExportButton, FilterSelect, KV, PageHead, RegisterSearch, SavedFilters, SecretOnce, langOptions, useRegister, useRowNav, useUrlFilters, AsyncButton } from "../components";

const ROLES: Role[] = ["reporter", "action_owner", "verifier", "site_safety_officer", "site_head", "hse_manager", "admin", "auditor"];
const ALL_SITES: Role[] = ["hse_manager", "admin", "auditor"];
const STATUSES: UserAdmin["status"][] = ["active", "suspended", "deactivated"];

export default function Users() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();
  const { perms } = useAuth();
  const { siteId, siteName, sites } = useScope();
  const reg = useRegister<UserAdmin>("users", "/admin/users");
  useUrlFilters(reg, ["role", "status"]);
  const [create, setCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  useRowNav(tableRef, !id && !create);
  const canEdit = perms.isAdmin && !perms.readOnly;
  const columns: Column<UserAdmin>[] = [
    { key: "name", label: t("users.name"), render: (u) => <div><div className="cell-title">{u.name}</div><div className="cell-sub">{u.employeeCode}{u.email ? ` · ${u.email}` : ""}{u.employerName ? ` · ${u.employerName}` : ""}</div></div> },
    { key: "roles", label: t("users.roles"), render: (u) => <div className="row" style={{ gap: 4 }}>{u.roles.slice(0, 3).map((r, i) => <Pill key={i} tone={r.role === "admin" ? "hivis" : r.role === "auditor" ? "blue" : undefined} title={r.siteId ? siteName(r.siteId) : t("role.allSites")}>{t(`role.${r.role}`)}{r.siteId ? ` · ${sites.find((s) => s.id === r.siteId)?.code ?? ""}` : ""}</Pill>)}{u.roles.length > 3 ? <span className="small muted">+{u.roles.length - 3}</span> : null}</div> },
    { key: "login", label: t("users.loginType"), render: (u) => <div>{t(`users.loginType.${u.loginType}`)}<div className="cell-sub">{u.mfaEnabled ? t("users.mfaOn") : t("users.mfaOff")}{u.mustChangePassword ? ` · ${t("users.mustChange")}` : ""}</div></div>, width: 160 },
    { key: "status", label: t("common.status"), render: (u) => <span className="row nowrap" style={{ gap: 4 }}><Pill tone={u.status === "active" ? "green" : u.status === "suspended" ? "amber" : "grey"}>{t(`users.status.${u.status}`)}</Pill>{u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() ? <Pill tone="red" title={t("users.lockedUntil", { time: fmtDateTime(u.lockedUntil, lang) })}><IconLock size={11} /></Pill> : null}{u.expiresAt ? <Pill tone={new Date(u.expiresAt).getTime() < Date.now() ? "red" : "grey"}>{t("users.expires")} {fmtDate(u.expiresAt, lang)}</Pill> : null}</span>, width: 180 },
    { key: "lastLoginAt", label: t("users.lastLogin"), render: (u) => u.lastLoginAt ? <span title={fmtDateTime(u.lastLoginAt, lang)}>{relative(u.lastLoginAt, t, lang)}</span> : <span className="muted">{t("users.neverLoggedIn")}</span>, sortable: true, width: 130 },
  ];
  return (
    <>
      <PageHead title={t("nav.users")} sub={siteId ? siteName(siteId) : t("top.allSites")} tools={<>
        <ExportButton onExport={async () => localCsv((reg.data?.items ?? []).map((u) => ({ name: u.name, employee_code: u.employeeCode, email: u.email, login_type: u.loginType, status: u.status, roles: u.roles.map((r) => `${r.role}@${r.siteId ? sites.find((s) => s.id === r.siteId)?.code ?? r.siteId : "*"}`).join("|"), mfa: u.mfaEnabled, last_login: u.lastLoginAt ?? "" })), "users.csv")} />
        {canEdit ? <><Button size="sm" onClick={() => setImporting(true)}>{t("csv.importCsv")}</Button><Button variant="primary" onClick={() => setCreate(true)}><IconPlus size={16} />{t("users.new")}</Button></> : null}
      </>} />
      <div className="filters">
        <RegisterSearch reg={reg} placeholder={t("users.searchPh")} />
        <FilterSelect label={t("users.role")} value={reg.filters.role ?? ""} onChange={(v) => reg.setFilter("role", v)} options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} />
        <FilterSelect label={t("common.status")} value={reg.filters.status ?? ""} onChange={(v) => reg.setFilter("status", v)} options={STATUSES.map((s) => ({ value: s, label: t(`users.status.${s}`) }))} />
      </div>
      <SavedFilters reg={reg} />
      {reg.error && !reg.data ? <ErrorCard error={reg.error} onRetry={reg.reload} /> : null}
      <CountLine total={reg.data?.total} loading={reg.loading} />
      <div ref={tableRef}>
        <DataTable columns={columns} rows={reg.data?.items ?? []} rowKey={(u) => u.id} loading={reg.loading} sort={reg.sort ?? undefined} onSort={reg.toggleSort} onRow={(u) => nav(`/users/${u.id}`)}
          empty={reg.hasFilters ? <SearchEmpty q={reg.q} onClear={reg.clearFilters} /> : <EmptyState icon={<IconUsers />} title={t("users.empty")} body={t("users.emptyHint")} action={canEdit ? <span className="btn-group"><Button size="sm" variant="primary" onClick={() => setCreate(true)}>{t("users.new")}</Button><Button size="sm" onClick={() => setImporting(true)}>{t("csv.importCsv")}</Button></span> : undefined} />} />
      </div>
      {reg.data ? <Pagination page={reg.data.page} pageSize={reg.data.pageSize} total={reg.data.total} onPage={reg.setPage} /> : null}
      {create ? <UserSheet onClose={() => setCreate(false)} onSaved={() => { reg.reload(); }} /> : null}
      {id ? <UserDrawer id={id} onClose={() => nav("/users")} onChanged={(u) => reg.patch((r) => r.id === u.id, () => u)} onRemoved={() => reg.reload()} canEdit={canEdit} /> : null}
      {importing ? (
        <Sheet title={t("users.importTitle")} onClose={() => setImporting(false)} wide>
          <CsvImport columns={[
            { key: "name", label: t("users.name"), required: true },
            { key: "employee_code", label: t("users.employeeCode"), validate: (v, r) => (!v && !r.email ? t("users.codeOrEmail") : null) },
            { key: "email", label: t("users.email"), validate: (v) => (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? t("users.emailBad") : null) },
            { key: "language", label: t("common.language"), options: ["en", "hi", "ta", "kn"] },
            { key: "employer", label: t("common.employer") }, { key: "trade", label: t("common.trade") }, { key: "phone", label: t("users.phone") },
            { key: "role", label: t("users.role"), required: true, options: ROLES },
            { key: "site_code", label: t("sites.code"), validate: (v, r) => (!v && !ALL_SITES.includes(r.role as Role) ? t("users.siteRequired") : v && !sites.some((s) => s.code === v) ? t("csv.unknownSite") : null) },
          ]} sample={"name,employee_code,email,language,employer,trade,phone,role,site_code\nPriya Rao,E1001,,ta,,,9876501234,reporter,TN1\nKarthik Iyer,E1002,karthik@example.in,en,,,,site_safety_officer,TN1"}
            onImport={(csv) => api.post<ImportResult>("/admin/users/import", { csv })} onDone={() => { setImporting(false); reg.reload(); }} />
        </Sheet>
      ) : null}
    </>
  );
}

type RoleRow = { siteId: string | null; role: Role; medicalData: boolean; expiresAt: string | null };

function RolesEditor({ rows, onChange }: { rows: RoleRow[]; onChange: (r: RoleRow[]) => void }) {
  const { t, pick } = useI18n();
  const { sites } = useScope();
  const set = (i: number, patch: Partial<RoleRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch, ...(patch.role && ALL_SITES.includes(patch.role) ? { siteId: null } : {}) } : r)));
  return (
    <div className="role-rows">
      {rows.map((r, i) => (
        <div className="role-row" key={i}>
          <Select value={r.role} onChange={(e) => set(i, { role: e.target.value as Role })} aria-label={t("users.role")}>{ROLES.map((x) => <option key={x} value={x}>{t(`role.${x}`)}</option>)}</Select>
          <Select value={r.siteId ?? ""} onChange={(e) => set(i, { siteId: e.target.value || null })} aria-label={t("common.site")} disabled={ALL_SITES.includes(r.role)}>
            <option value="">{t("role.allSites")}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {pick(s.name)}</option>)}
          </Select>
          <label className="chk" title={t("users.medicalHint")}><input type="checkbox" checked={r.medicalData} onChange={(e) => set(i, { medicalData: e.target.checked })} /> {t("users.medical")}</label>
          {r.role === "auditor" ? <Input type="date" value={dateInputValue(r.expiresAt)} onChange={(e) => set(i, { expiresAt: e.target.value || null })} aria-label={t("users.expires")} /> : <span className="small muted" />}
          <Button size="sm" variant="ghost" icon onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t("common.remove")} disabled={rows.length === 1}><IconTrash size={14} /></Button>
        </div>
      ))}
      <div><Button size="sm" onClick={() => onChange([...rows, { siteId: sites[0]?.id ?? null, role: "reporter", medicalData: false, expiresAt: null }])}><IconPlus size={14} />{t("users.addRole")}</Button></div>
    </div>
  );
}

function defaultExpiry() { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); }

function UserSheet({ user, onClose, onSaved }: { user?: UserAdmin; onClose: () => void; onSaved: (u: UserAdmin) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { contractors, sites } = useScope();
  const [f, setF] = useState<UserCreate>(user ? { name: user.name, employeeCode: user.employeeCode, email: user.email, loginType: user.loginType, language: user.language, employerId: user.employerId, roles: user.roles.map((r) => ({ siteId: r.siteId, role: r.role, medicalData: r.medicalData, expiresAt: r.expiresAt ?? null })), expiresAt: user.expiresAt } : { name: "", employeeCode: "", email: "", loginType: "employee_code", language: "en", employerId: null, trade: "", phone: "", roles: [{ siteId: sites[0]?.id ?? null, role: "reporter", medicalData: false, expiresAt: null }] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [secret, setSecret] = useState<{ user: UserAdmin; tempPassword?: string; code?: string; expiresAt?: string } | null>(null);
  const emailBad = !!f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  const needsEmail = f.loginType === "email";
  const needsCode = f.loginType !== "email";
  const problems: string[] = [];
  if (!f.name.trim()) problems.push("name");
  if (needsEmail && !f.email) problems.push("email");
  if (needsCode && !f.employeeCode) problems.push("code");
  if (emailBad) problems.push("emailBad");
  if (f.roles.length === 0) problems.push("roles");
  if (f.roles.some((r) => !ALL_SITES.includes(r.role) && !r.siteId)) problems.push("roleSite");
  const auditor = f.roles.some((r) => r.role === "auditor");
  useEffect(() => { if (auditor && !f.expiresAt) setF((x) => ({ ...x, expiresAt: defaultExpiry() })); }, [auditor, f.expiresAt]);
  const staffRoles = f.roles.some((r) => ["admin", "hse_manager", "site_head", "site_safety_officer", "auditor"].includes(r.role));
  if (secret) {
    return (
      <Sheet title={t("users.createdTitle", { name: secret.user.name })} onClose={() => { onSaved(secret.user); onClose(); }} footer={<Button variant="primary" onClick={() => { onSaved(secret.user); onClose(); }}>{t("common.done")}</Button>}>
        <p>{secret.tempPassword ? t("users.tempPasswordBody") : t("users.enrolCodeBody", { until: secret.expiresAt ? fmtDateTime(secret.expiresAt) : "" })}</p>
        {secret.tempPassword ? <SecretOnce label={t("users.tempPassword")} value={secret.tempPassword} /> : null}
        {secret.code ? <SecretOnce label={t("users.enrolCode")} value={secret.code} /> : null}
        {!secret.tempPassword && !secret.code ? <div className="banner info">{t("users.noSecretReturned")}</div> : null}
        <p className="small muted" style={{ marginTop: 12 }}>{t("users.loginAs", { login: secret.user.loginType === "email" ? secret.user.email : secret.user.employeeCode })}</p>
      </Sheet>
    );
  }
  return (
    <Sheet title={user ? `${t("common.edit")} · ${user.name}` : t("users.new")} onClose={onClose} wide footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={problems.length > 0} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try {
        if (user) {
          const u = await api.put<UserAdmin>(`/admin/users/${user.id}`, { ...f, roles: undefined });
          const u2 = await api.post<UserAdmin>(`/admin/users/${user.id}/roles`, { roles: f.roles });
          toast.success(t("common.saved")); onSaved({ ...u, ...u2, roles: u2.roles ?? f.roles as SiteRole[] }); onClose();
        } else {
          const r = await api.post<UserAdmin & { tempPassword?: string; enrolmentCode?: string; code?: string; expiresAt?: string }>("/admin/users", f);
          const { tempPassword, enrolmentCode, code, ...u } = r;
          setSecret({ user: u as UserAdmin, tempPassword, code: enrolmentCode ?? code, expiresAt: r.expiresAt });
        }
      } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }} data-testid="save-user">{user ? t("common.save") : t("users.create")}</Button></>}>
      <div className="form-grid">
        <Field label={t("users.name")} required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} autoFocus /></Field>
        <Field label={t("users.loginType")} hint={t(`users.loginType.${f.loginType}.hint`)}>
          <Select value={f.loginType} onChange={(e) => setF({ ...f, loginType: e.target.value as Me["loginType"] })} disabled={!!user}>
            <option value="employee_code">{t("users.loginType.employee_code")}</option><option value="email">{t("users.loginType.email")}</option><option value="enrolment_code">{t("users.loginType.enrolment_code")}</option>
          </Select>
        </Field>
        <Field label={t("users.employeeCode")} required={needsCode}><Input value={f.employeeCode ?? ""} onChange={(e) => setF({ ...f, employeeCode: e.target.value.toUpperCase() })} maxLength={30} /></Field>
        <Field label={t("users.email")} required={needsEmail} error={emailBad ? t("users.emailBad") : undefined} hint={staffRoles ? t("users.staffEmailHint") : undefined}><Input type="email" value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t("common.language")}><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as Lang })}>{langOptions.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></Field>
        <Field label={t("common.employer")}><Select value={f.employerId ?? ""} onChange={(e) => setF({ ...f, employerId: e.target.value || null })}><option value="">{t("common.ownCompany")}</option>{contractors.data.filter((c) => !c.isOwnCompany).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        {!user ? <><Field label={t("common.trade")} optional><Input value={f.trade ?? ""} onChange={(e) => setF({ ...f, trade: e.target.value })} maxLength={60} /></Field>
          <Field label={t("users.phone")} optional><Input value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" maxLength={20} /></Field></> : null}
      </div>
      <Field label={t("users.roles")} required hint={t("users.rolesHint")} error={problems.includes("roleSite") ? t("users.siteRequired") : undefined}>
        <RolesEditor rows={f.roles as RoleRow[]} onChange={(rows) => setF({ ...f, roles: rows })} />
      </Field>
      {auditor ? <Field label={t("users.accountExpires")} required hint={t("users.auditorExpiryHint")}><Input type="date" value={f.expiresAt?.slice(0, 10) ?? ""} onChange={(e) => setF({ ...f, expiresAt: e.target.value || null })} /></Field> : null}
      {staffRoles ? <div className="banner info"><IconShield size={16} />{t("users.mfaNote")}</div> : null}
      {err ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

function UserDrawer({ id, onClose, onChanged, onRemoved, canEdit }: { id: string; onClose: () => void; onChanged: (u: UserAdmin) => void; onRemoved: () => void; canEdit: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { siteName } = useScope();
  const { me } = useAuth();
  const state = useLoad(() => api.get<UserAdmin>(`/admin/users/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [secret, setSecret] = useState<{ label: string; value: string; hint?: string } | null>(null);
  const u = state.data;
  const apply = (nu: UserAdmin) => { state.setData(nu); onChanged(nu); };
  const self = me?.id === id;
  const setStatus = (status: UserAdmin["status"]) => {
    if (!u) return;
    const prev = u;
    apply({ ...u, status });
    toast.undoable(t(status === "deactivated" ? "users.deactivating" : status === "suspended" ? "users.suspending" : "users.reactivating", { name: u.name }),
      async () => { try { apply(await api.post<UserAdmin>(`/admin/users/${u.id}/status`, { status })); if (status === "deactivated") onRemoved(); } catch (e) { toast.error(errMessage(e)); apply(prev); } },
      () => apply(prev));
  };
  return (
    <Drawer title={u ? u.name : t("common.loading")} kicker={u ? `${u.employeeCode}${u.email ? ` · ${u.email}` : ""}` : undefined} onClose={onClose} footer={u && canEdit ? (
      <>
        <Button variant="primary" onClick={() => setEdit(true)}>{t("common.edit")}</Button>
        {u.status === "active" ? <Button onClick={() => setStatus("suspended")} disabled={self}>{t("users.suspend")}</Button> : <Button onClick={() => setStatus("active")}>{t("users.reactivate")}</Button>}
        {u.status !== "deactivated" ? <Button variant="danger" onClick={() => setStatus("deactivated")} disabled={self}>{t("users.deactivate")}</Button> : null}
        <span className="grow" /><Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
      </>
    ) : undefined}>
      {state.error && !u ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!u && !state.error ? <Skeleton lines={8} /> : null}
      {u ? (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row"><Pill tone={u.status === "active" ? "green" : u.status === "suspended" ? "amber" : "grey"}>{t(`users.status.${u.status}`)}</Pill><Pill>{t(`users.loginType.${u.loginType}`)}</Pill><Pill tone={u.mfaEnabled ? "green" : "grey"}>{u.mfaEnabled ? t("users.mfaOn") : t("users.mfaOff")}</Pill>{u.mustChangePassword ? <Pill tone="amber">{t("users.mustChange")}</Pill> : null}{u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now() ? <Pill tone="red">{t("users.lockedUntil", { time: fmtDateTime(u.lockedUntil, lang) })}</Pill> : null}</div>
          {secret ? <SecretOnce label={secret.label} value={secret.value} hint={secret.hint} /> : null}
          <KV rows={[{ k: t("common.language"), v: langOptions.find((l) => l.value === u.language)?.label }, { k: t("common.employer"), v: u.employerName ?? t("common.ownCompany") }, { k: t("users.lastLogin"), v: u.lastLoginAt ? fmtDateTime(u.lastLoginAt, lang) : t("users.neverLoggedIn") }, { k: t("users.failedAttempts"), v: String(u.failedAttempts) }, { k: t("users.created"), v: fmtDate(u.createdAt, lang) }, ...(u.expiresAt ? [{ k: t("users.accountExpires"), v: fmtDate(u.expiresAt, lang) }] : [])]} />
          <div>
            <div className="section-title">{t("users.roles")}</div>
            <div className="list-compact">{u.roles.map((r, i) => <div className="li" key={i}><strong>{t(`role.${r.role}`)}</strong><span className="sp">{r.siteId ? siteName(r.siteId) : t("role.allSites")}</span>{r.medicalData ? <Pill tone="orange">{t("users.medical")}</Pill> : null}{r.expiresAt ? <span className="small muted">{t("users.expires")} {fmtDate(r.expiresAt, lang)}</span> : null}</div>)}</div>
          </div>
          {canEdit ? (
            <div>
              <div className="section-title">{t("users.security")}</div>
              <div className="btn-group">
                {u.loginType !== "enrolment_code" ? <AsyncButton size="sm" onClick={async () => { const r = await api.post<{ tempPassword: string }>(`/admin/users/${u.id}/reset-password`); setSecret({ label: t("users.tempPassword"), value: r.tempPassword }); apply({ ...u, mustChangePassword: true }); }}><IconKey size={14} />{t("users.resetPassword")}</AsyncButton> : null}
                <AsyncButton size="sm" onClick={async () => { const r = await api.post<{ code: string; expiresAt: string }>(`/admin/users/${u.id}/enrolment-code`); setSecret({ label: t("users.enrolCode"), value: r.code, hint: t("users.enrolCodeBody", { until: fmtDateTime(r.expiresAt, lang) }) }); }}>{t("users.issueEnrolCode")}</AsyncButton>
                {u.lockedUntil ? <AsyncButton size="sm" onClick={async () => { apply(await api.post<UserAdmin>(`/admin/users/${u.id}/unlock`)); toast.success(t("users.unlocked")); }}><IconLock size={14} />{t("users.unlock")}</AsyncButton> : null}
                {u.mfaEnabled ? <AsyncButton size="sm" onClick={async () => { apply(await api.post<UserAdmin>(`/admin/users/${u.id}/mfa/reset`)); toast.success(t("users.mfaResetDone")); }}><IconShield size={14} />{t("users.mfaReset")}</AsyncButton> : null}
              </div>
            </div>
          ) : null}
          <div>
            <div className="section-title">{t("users.devices")} ({u.devices.length})</div>
            {u.devices.length ? (
              <div className="table-wrap"><table className="table"><thead><tr><th>{t("users.platform")}</th><th>{t("users.appVersion")}</th><th>{t("users.lastSeen")}</th><th /></tr></thead>
                <tbody>{u.devices.map((d) => <tr key={d.id}><td>{d.platform}</td><td className="mono-sm">{d.appVersion}</td><td>{relative(d.lastSeenAt, t, lang)}</td><td>{d.revokedAt ? <Pill tone="grey">{t("users.revoked")}</Pill> : canEdit ? <AsyncButton size="sm" variant="ghost" onClick={async () => { await api.post(`/admin/users/${u.id}/devices/${d.id}/revoke`); apply({ ...u, devices: u.devices.map((x) => (x.id === d.id ? { ...x, revokedAt: new Date().toISOString() } : x)) }); toast.success(t("users.deviceRevoked")); }}>{t("users.revoke")}</AsyncButton> : null}</td></tr>)}</tbody></table></div>
            ) : <p className="small muted">{t("users.noDevices")}</p>}
          </div>
        </div>
      ) : null}
      {edit && u ? <UserSheet user={u} onClose={() => setEdit(false)} onSaved={apply} /> : null}
    </Drawer>
  );
}
