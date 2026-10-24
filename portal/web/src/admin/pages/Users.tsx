import { FormEvent, useEffect, useMemo, useState } from "react";
import { Field, Select } from "../../shared/forms";
import { fmtDateTime } from "../../shared/format";
import { IconDownload, IconLock, IconPlus } from "../../shared/icons";
import type { Role } from "../../shared/types";
import { Empty, ErrorNote, Sheet, Spinner, useLoad, useToast } from "../../shared/ui";
import { api, copyText, csvCell, errMsg, saveBlob, useAuth } from "../ctx";
import type { AdminContractor, AdminSite, AdminUser, RoleMeta } from "../types";
import { PageHead, Pager, useAdminSites, useContractors, useRoles } from "./common";
import { passwordIssue } from "./ChangePassword";

const PAGE_SIZE = 100;
const ADMIN_ROLES: Role[] = ["platform_admin", "org_admin"];

interface RoleRow {
  role: Role | "";
  siteId: string | null;
}

export default function Users() {
  const { canWrite } = useAuth();
  const sites = useAdminSites();
  const contractors = useContractors();
  const roles = useRoles();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [siteId, setSiteId] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useLoad<{ total: number; users: AdminUser[] }>(
    () => api.get("/api/admin/users", { q: query || undefined, siteId: siteId || undefined, role: role || undefined, status, page, pageSize: PAGE_SIZE }),
    [query, siteId, role, status, page],
  );
  useEffect(() => setPage(1), [query, siteId, role, status]);

  const openUser = list.data?.users.find((u) => u.id === openId) ?? null;
  const ready = sites.data && contractors.data && roles.data;

  return (
    <div>
      <PageHead
        title="Users & passwords"
        sub="Every login is an employee ID. Create users, give them roles per site, and set or reset their passwords. Admins never see a user's existing password."
        actions={
          canWrite && (
            <>
              <button className="btn" onClick={() => setImporting(true)} disabled={!ready}>
                Bulk import
              </button>
              <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={!ready}>
                <IconPlus size={18} /> Add user
              </button>
            </>
          )
        }
      />
      <div className="filters" role="search">
        <form
          className="field"
          style={{ gridColumn: "span 2" }}
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <label htmlFor="u-q">Search</label>
          <div className="row">
            <input id="u-q" className="input grow" placeholder="Employee ID, name or designation" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn">Search</button>
          </div>
        </form>
        <div className="field">
          <label htmlFor="u-site">Site</label>
          <Select id="u-site" value={siteId} onChange={setSiteId} placeholder="All sites" options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
        </div>
        <div className="field">
          <label htmlFor="u-role">Role</label>
          <Select id="u-role" value={role} onChange={setRole} placeholder="All roles" options={(roles.data?.roles ?? []).map((r) => ({ value: r.role, label: r.label }))} />
        </div>
        <div className="field">
          <label htmlFor="u-status">Status</label>
          <select id="u-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All users</option>
            <option value="active">Active</option>
            <option value="locked">Locked out</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>
      </div>

      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.users.length === 0 && (
        <div className="section">
          <Empty title="No users match">
            <p>{canWrite ? "Clear the filters, or add a user with the button above." : "Clear the filters to see everyone."}</p>
          </Empty>
        </div>
      )}
      {list.data && list.data.users.length > 0 && (
        <div className="table-wrap" style={list.loading ? { opacity: 0.6 } : undefined}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {list.data.users.map((u) => (
                <tr key={u.id} className={`click ${u.active ? "" : "inactive"}`} tabIndex={0} onClick={() => setOpenId(u.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(u.id)}>
                  <td>
                    <span className="code">{u.employeeId}</span>
                  </td>
                  <td>
                    <strong>{u.name}</strong>
                    <div className="small muted">
                      {u.designation}
                      {u.contractorName ? ` · ${u.contractorName}` : ""}
                    </div>
                  </td>
                  <td>
                    <RoleTags roles={u.roles} />
                  </td>
                  <td>
                    <UserState u={u} />
                  </td>
                  <td className="small">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}

      {creating && ready && (
        <CreateUserSheet
          sites={sites.data!.sites}
          contractors={contractors.data!.contractors}
          roles={roles.data!.roles}
          onClose={() => setCreating(false)}
          onCreated={() => list.reload()}
        />
      )}
      {openUser && ready && (
        <UserSheet
          key={openUser.id}
          user={openUser}
          sites={sites.data!.sites}
          contractors={contractors.data!.contractors}
          roles={roles.data!.roles}
          canWrite={canWrite}
          onClose={() => setOpenId(null)}
          onChanged={() => list.reload()}
        />
      )}
      {importing && <BulkImportSheet sites={sites.data?.sites ?? []} onClose={() => setImporting(false)} onDone={() => list.reload()} />}
    </div>
  );
}

function RoleTags({ roles }: { roles: AdminUser["roles"] }) {
  if (!roles.length) return <span className="small" style={{ color: "var(--red)" }}>No role – cannot sign in</span>;
  return (
    <span className="role-tags">
      {roles.map((r, i) => (
        <span key={i} className={`role-tag ${ADMIN_ROLES.includes(r.role) ? "admin" : ""}`}>
          {r.roleLabel}
          {r.siteCode ? ` · ${r.siteCode}` : r.siteId === null && !ADMIN_ROLES.includes(r.role) ? " · all sites" : ""}
        </span>
      ))}
    </span>
  );
}

function UserState({ u }: { u: AdminUser }) {
  return (
    <span className="role-tags">
      {!u.active ? <span className="state-tag off">Deactivated</span> : <span className="state-tag ok">Active</span>}
      {u.locked && (
        <span className="state-tag locked">
          <IconLock size={12} /> Locked
        </span>
      )}
      {u.active && u.mustChangePassword && <span className="state-tag pw">Must set password</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Roles editor (create + edit)
// ---------------------------------------------------------------------------------------------

function RolesEditor({ rows, onChange, roles, sites, disabled }: { rows: RoleRow[]; onChange: (r: RoleRow[]) => void; roles: RoleMeta[]; sites: AdminSite[]; disabled?: boolean }) {
  const { me } = useAuth();
  const isPlatform = me.roles.some((r) => r.role === "platform_admin");
  const options = roles.filter((r) => r.role !== "platform_admin" || isPlatform || rows.some((x) => x.role === "platform_admin"));
  const scopeOf = (role: Role | "") => roles.find((r) => r.role === role)?.scope ?? "site";
  const activeSites = sites.filter((s) => s.active);

  function update(i: number, patch: Partial<RoleRow>) {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    const row = next[i];
    const scope = scopeOf(row.role);
    if (scope === "company") row.siteId = null;
    if (scope === "site" && row.siteId === null && patch.role) row.siteId = activeSites[0]?.id ?? null;
    onChange(next);
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r, i) => {
        const scope = scopeOf(r.role);
        return (
          <div className="role-row" key={i}>
            <Field label={i === 0 ? "Role" : `Role ${i + 1}`} htmlFor={`role-${i}`}>
              <select id={`role-${i}`} className="select" value={r.role} disabled={disabled} onChange={(e) => update(i, { role: e.target.value as Role })} required>
                <option value="">Choose role…</option>
                {options.map((o) => (
                  <option key={o.role} value={o.role}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Where" htmlFor={`site-${i}`}>
              {scope === "company" ? (
                <input id={`site-${i}`} className="input" value="Whole company" disabled readOnly />
              ) : (
                <select
                  id={`site-${i}`}
                  className="select"
                  value={r.siteId ?? ""}
                  disabled={disabled || !r.role}
                  onChange={(e) => update(i, { siteId: e.target.value || null })}
                  required={scope === "site"}
                >
                  {scope === "either" && <option value="">All sites</option>}
                  {scope === "site" && <option value="">Choose site…</option>}
                  {activeSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled || rows.length <= 1}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              aria-label={`Remove role ${i + 1}`}
              style={{ marginBottom: 6 }}
            >
              Remove
            </button>
          </div>
        );
      })}
      {!disabled && (
        <div>
          <button type="button" className="btn btn-sm" onClick={() => onChange([...rows, { role: "", siteId: null }])}>
            Add another role
          </button>
        </div>
      )}
      <p className="small muted">
        Safety officers raise and approve points on their site; supervisors only close the points assigned to them. Admins and management viewers use this console.
      </p>
    </div>
  );
}

function rolesProblem(rows: RoleRow[], roles: RoleMeta[]): string | null {
  if (!rows.length) return "Give the user at least one role.";
  for (const r of rows) {
    if (!r.role) return "Choose a role in every row.";
    const scope = roles.find((x) => x.role === r.role)?.scope;
    if (scope === "site" && !r.siteId) return "Choose the site for each site role.";
  }
  const keys = rows.map((r) => `${r.role}:${r.siteId ?? "*"}`);
  if (new Set(keys).size !== keys.length) return "The same role is listed twice.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// One-time credential panel
// ---------------------------------------------------------------------------------------------

function CredentialPanel({ employeeId, name, password }: { employeeId: string; name: string; password: string }) {
  const toast = useToast();
  return (
    <div className="cred" role="status">
      <span className="who">
        {name} · employee ID <span className="code">{employeeId}</span>
      </span>
      <span className="small muted">Temporary password</span>
      <span className="pw">{password}</span>
      <div className="row-wrap">
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => toast((await copyText(`Employee ID: ${employeeId}\nTemporary password: ${password}`)) ? "Copied" : "Copy failed – select the text instead", false)}
        >
          Copy
        </button>
      </div>
      <div className="alert warn small">
        This password is shown only now and cannot be seen again. Give it to the person directly. They must set their own password at first sign-in.
      </div>
    </div>
  );
}

function PasswordChoice({
  mode,
  setMode,
  value,
  setValue,
  mustChange,
  setMustChange,
  fixedSet,
}: {
  fixedSet?: boolean;
  mode: "temp" | "set";
  setMode: (m: "temp" | "set") => void;
  value: string;
  setValue: (v: string) => void;
  mustChange: boolean;
  setMustChange: (v: boolean) => void;
}) {
  const [show, setShow] = useState(false);
  const issue = mode === "set" && value ? passwordIssue(value) : null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {!fixedSet && (
      <div className="radio-cards" role="radiogroup" aria-label="Password">
        <label>
          <input type="radio" name="pwmode" checked={mode === "temp"} onChange={() => setMode("temp")} />
          <span>
            <strong>Generate a temporary password</strong>
            <br />
            <span className="small muted">Shown once after saving. The person sets their own at first sign-in.</span>
          </span>
        </label>
        <label>
          <input type="radio" name="pwmode" checked={mode === "set"} onChange={() => setMode("set")} />
          <span>
            <strong>Set a password myself</strong>
            <br />
            <span className="small muted">At least 8 characters with letters and numbers.</span>
          </span>
        </label>
      </div>
      )}
      {mode === "set" && (
        <>
          <Field label="Password" htmlFor="setpw">
            <div className="row">
              <input
                id="setpw"
                className="input grow"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={value}
                aria-invalid={!!issue}
                onChange={(e) => setValue(e.target.value)}
                required
              />
              <button type="button" className="btn btn-sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
          {issue && <p className="small" style={{ color: "var(--red)" }}>{issue}</p>}
          <label className="checkline">
            <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
            <span>Ask them to change it at first sign-in (recommended)</span>
          </label>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------------------------

function CreateUserSheet({
  sites,
  contractors,
  roles,
  onClose,
  onCreated,
}: {
  sites: AdminSite[];
  contractors: AdminContractor[];
  roles: RoleMeta[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [f, setF] = useState({ employeeId: "", name: "", designation: "", phone: "", email: "", contractorId: "" });
  const [rows, setRows] = useState<RoleRow[]>([{ role: "", siteId: null }]);
  const [mode, setMode] = useState<"temp" | "set">("temp");
  const [pw, setPw] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ employeeId: string; name: string; temp: string | null } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const rp = rolesProblem(rows, roles);
    if (rp) return setError(rp);
    if (mode === "set") {
      const issue = passwordIssue(pw);
      if (issue) return setError(issue);
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ id: string; tempPassword: string | null }>("/api/admin/users", {
        ...f,
        contractorId: f.contractorId || null,
        roles: rows.map((r) => ({ role: r.role, siteId: r.siteId })),
        password: mode === "temp" ? { mode: "temp", mustChange: true } : { mode: "set", value: pw, mustChange },
      });
      setDone({ employeeId: f.employeeId.trim(), name: f.name.trim(), temp: r.tempPassword });
      onCreated();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet title="User created" onClose={onClose}>
        <div className="stack">
          {done.temp ? (
            <CredentialPanel employeeId={done.employeeId} name={done.name} password={done.temp} />
          ) : (
            <div className="alert ok">
              {done.name} ({done.employeeId}) can sign in with the password you set{mustChange ? " and will be asked to change it" : ""}.
            </div>
          )}
          <button className="btn btn-primary btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Add user" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Employee ID" required htmlFor="n-emp" hint="This is the login. Letters, digits and . _ - / only.">
            <input id="n-emp" className="input code" value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)} required maxLength={40} autoComplete="off" />
          </Field>
          <Field label="Full name" required htmlFor="n-name">
            <input id="n-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} />
          </Field>
          <Field label="Designation" htmlFor="n-des">
            <input id="n-des" className="input" value={f.designation} onChange={(e) => set("designation", e.target.value)} placeholder="e.g. Safety Officer, Site Supervisor" />
          </Field>
          <Field label="Contractor company" htmlFor="n-con" hint="Only for contractor staff.">
            <Select id="n-con" value={f.contractorId} onChange={(v) => set("contractorId", v)} placeholder="Own employee" options={contractors.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Phone" htmlFor="n-ph">
            <input id="n-ph" className="input" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="n-em" hint="Optional. Used for alerts such as assignments and approvals.">
            <input id="n-em" className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
        </div>
        <div className="sheet-section">
          <h3>Roles</h3>
          <RolesEditor rows={rows} onChange={setRows} roles={roles} sites={sites} />
        </div>
        <div className="sheet-section">
          <h3>Password</h3>
          <PasswordChoice mode={mode} setMode={setMode} value={pw} setValue={setPw} mustChange={mustChange} setMustChange={setMustChange} />
        </div>
        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating…" : "Create user"}
        </button>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// User detail: password & access, details, roles
// ---------------------------------------------------------------------------------------------

function UserSheet({
  user,
  sites,
  contractors,
  roles,
  canWrite,
  onClose,
  onChanged,
}: {
  user: AdminUser;
  sites: AdminSite[];
  contractors: AdminContractor[];
  roles: RoleMeta[];
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { me } = useAuth();
  const toast = useToast();
  const isSelf = user.id === me.id;
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const [pw, setPw] = useState("");
  const [pwMust, setPwMust] = useState(true);
  const [confirmOff, setConfirmOff] = useState(false);
  const [f, setF] = useState({ name: user.name, designation: user.designation, phone: user.phone, email: user.email, contractorId: user.contractorId ?? "" });
  const [rows, setRows] = useState<RoleRow[]>(user.roles.map((r) => ({ role: r.role, siteId: r.siteId })));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const rolesChanged = useMemo(
    () => JSON.stringify(rows.map((r) => `${r.role}:${r.siteId}`).sort()) !== JSON.stringify(user.roles.map((r) => `${r.role}:${r.siteId}`).sort()),
    [rows, user.roles],
  );

  async function run<T>(fn: () => Promise<T>, msg: string): Promise<T | null> {
    setBusy(true);
    try {
      const r = await fn();
      toast(msg);
      onChanged();
      return r;
    } catch (e) {
      toast(errMsg(e), true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={user.name} onClose={onClose} wide>
      <div className="stack">
        <div className="row-wrap">
          <span className="code">{user.employeeId}</span>
          <UserState u={user} />
        </div>
        <p className="small muted">
          Created {fmtDateTime(user.createdAt)} · last sign-in {user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : "never"}
        </p>

        <section className="sheet-section stack" aria-labelledby="pw-h">
          <h3 id="pw-h">Password and access</h3>
          {temp && <CredentialPanel employeeId={user.employeeId} name={user.name} password={temp} />}
          {canWrite ? (
            <>
              <div className="row-wrap">
                <button
                  className="btn"
                  disabled={busy || !user.active}
                  onClick={async () => {
                    const r = await run(() => api.post<{ tempPassword: string }>(`/api/admin/users/${user.id}/password`, { mode: "temp" }), "Password reset. Signed out everywhere.");
                    if (r?.tempPassword) {
                      setTemp(r.tempPassword);
                      setSetting(false);
                    }
                  }}
                >
                  Reset to a temporary password
                </button>
                <button
                  className="btn"
                  disabled={busy || !user.active}
                  onClick={() => {
                    setTemp(null);
                    setSetting((s) => !s);
                  }}
                  aria-expanded={setting}
                >
                  Set a password
                </button>
                {user.locked && (
                  <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post(`/api/admin/users/${user.id}/unlock`), "Account unlocked")}>
                    Unlock account
                  </button>
                )}
                {user.active && !user.mustChangePassword && (
                  <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/api/admin/users/${user.id}/force-change`), "They must set a new password at next sign-in")}>
                    Ask to change at next sign-in
                  </button>
                )}
              </div>
              {setting && (
                <form
                  className="stack"
                  style={{ gap: 10 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const issue = passwordIssue(pw);
                    if (issue) return toast(issue, true);
                    const r = await run(() => api.post(`/api/admin/users/${user.id}/password`, { mode: "set", password: pw, mustChange: pwMust }), "Password set. Signed out everywhere.");
                    if (r) {
                      setPw("");
                      setSetting(false);
                    }
                  }}
                >
                  <PasswordChoice fixedSet mode="set" setMode={() => {}} value={pw} setValue={setPw} mustChange={pwMust} setMustChange={setPwMust} />
                  <button className="btn btn-primary" disabled={busy || !!passwordIssue(pw)}>
                    Save password
                  </button>
                </form>
              )}
              <p className="small muted">Resetting or setting a password signs the person out of every device and clears any lock.</p>
              {!isSelf && (
                <div className="row-wrap">
                  {user.active ? (
                    confirmOff ? (
                      <>
                        <span className="small">Deactivate {user.name}? Their past records keep their name.</span>
                        <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => run(() => api.post(`/api/admin/users/${user.id}/active`, { active: false }), "User deactivated").then(() => setConfirmOff(false))}>
                          Yes, deactivate
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmOff(false)}>
                          Keep active
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-ghost btn-danger" onClick={() => setConfirmOff(true)}>
                        Deactivate user
                      </button>
                    )
                  ) : (
                    <button className="btn btn-good" disabled={busy} onClick={() => run(() => api.post(`/api/admin/users/${user.id}/active`, { active: true }), "User reactivated")}>
                      Reactivate user
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="small muted">Only admins can reset passwords.</p>
          )}
        </section>

        <section className="sheet-section">
          <h3>Details</h3>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.patch(`/api/admin/users/${user.id}`, { ...f, contractorId: f.contractorId || null }), "Details saved");
            }}
          >
            <fieldset disabled={!canWrite} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="grid-2">
                <Field label="Full name" htmlFor="e-name">
                  <input id="e-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} />
                </Field>
                <Field label="Designation" htmlFor="e-des">
                  <input id="e-des" className="input" value={f.designation} onChange={(e) => set("designation", e.target.value)} />
                </Field>
                <Field label="Phone" htmlFor="e-ph">
                  <input id="e-ph" className="input" type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
                </Field>
                <Field label="Email" htmlFor="e-em">
                  <input id="e-em" className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
                </Field>
                <Field label="Contractor company" htmlFor="e-con">
                  <Select id="e-con" value={f.contractorId} onChange={(v) => set("contractorId", v)} placeholder="Own employee" options={contractors.map((c) => ({ value: c.id, label: c.name }))} />
                </Field>
              </div>
            </fieldset>
            {canWrite && (
              <div>
                <button className="btn" disabled={busy}>
                  Save details
                </button>
              </div>
            )}
          </form>
        </section>

        <section className="sheet-section">
          <h3>Roles</h3>
          <RolesEditor rows={rows} onChange={setRows} roles={roles} sites={sites} disabled={!canWrite} />
          {canWrite && (
            <div style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={busy || !rolesChanged}
                onClick={() => {
                  const rp = rolesProblem(rows, roles);
                  if (rp) return toast(rp, true);
                  void run(() => api.put(`/api/admin/users/${user.id}/roles`, { roles: rows }), "Roles saved");
                }}
              >
                Save roles
              </button>
            </div>
          )}
        </section>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------------------------

const TEMPLATE =
  "employee_id,name,designation,phone,email,role,site_code\r\n" +
  "SO1001,Arun Kumar,Safety Officer,9876543210,arun@example.com,safety officer,PS01\r\n" +
  "SUP2001,Ravi Shetty,Site Supervisor,9876500000,,supervisor,PS01\r\n" +
  "VIEW01,Meena Rao,Director – Operations,,meena@example.com,viewer,\r\n";

interface ImportResult {
  created: { employeeId: string; name: string; role: string; site: string; tempPassword: string }[];
  errors: { line: number; message: string }[];
  ready: number;
}

function BulkImportSheet({ sites, onClose, onDone }: { sites: AdminSite[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await api.post<ImportResult>("/api/admin/users/import", { csv, dryRun });
      if (dryRun) setCheck(r);
      else if (r.errors.length) setCheck(r);
      else {
        setResult(r);
        onDone();
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadCreds() {
    if (!result) return;
    const lines = ["employee_id,name,role,site,temporary_password", ...result.created.map((c) => [c.employeeId, c.name, c.role, c.site, c.tempPassword].map(csvCell).join(","))];
    saveBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), "safeworks-new-user-passwords.csv");
  }

  if (result) {
    return (
      <Sheet title={`${result.created.length} ${result.created.length === 1 ? "user" : "users"} created`} onClose={onClose} wide>
        <div className="stack">
          <div className="alert warn">
            These temporary passwords are shown only now. Download or copy them, hand each one over privately, then delete the file. Everyone sets their own password at first sign-in.
          </div>
          <div className="row-wrap">
            <button className="btn btn-primary" onClick={downloadCreds}>
              <IconDownload size={18} /> Download CSV
            </button>
            <button
              className="btn"
              onClick={async () => toast((await copyText(result.created.map((c) => `${c.employeeId}\t${c.name}\t${c.tempPassword}`).join("\n"))) ? "Copied" : "Copy failed", false)}
            >
              Copy all
            </button>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Site</th>
                  <th>Temporary password</th>
                </tr>
              </thead>
              <tbody>
                {result.created.map((c) => (
                  <tr key={c.employeeId}>
                    <td className="code">{c.employeeId}</td>
                    <td>{c.name}</td>
                    <td>{c.role}</td>
                    <td>{c.site}</td>
                    <td className="code" style={{ userSelect: "all" }}>
                      {c.tempPassword}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Bulk import users" onClose={onClose} wide>
      <div className="stack">
        <p className="small muted">
          One row per user with the columns employee_id, name, designation, phone, email, role, site_code. Roles: safety officer, supervisor, viewer, auditor or admin. Site
          codes: {sites.map((s) => s.code).join(", ") || "add sites first"}. Leave site_code empty for company-wide viewers, auditors and admins.
        </p>
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" onClick={() => saveBlob(new Blob(["﻿" + TEMPLATE], { type: "text/csv;charset=utf-8" }), "safeworks-users-template.csv")}>
            <IconDownload size={16} /> Download template
          </button>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 2_000_000) return toast("The file is larger than 2 MB. Split it into smaller files.", true);
                setCsv(await file.text());
                setCheck(null);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <Field label="Or paste the rows here" htmlFor="csv">
          <textarea
            id="csv"
            className="textarea"
            style={{ minHeight: 180, fontFamily: "var(--font)", fontSize: "0.9rem" }}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setCheck(null);
            }}
            placeholder={TEMPLATE}
          />
        </Field>
        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        {check && check.errors.length > 0 && (
          <div className="alert err" role="alert">
            <strong>Fix these rows and check again – nothing has been imported.</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {check.errors.slice(0, 50).map((er, i) => (
                <li key={i}>
                  Line {er.line}: {er.message}
                </li>
              ))}
            </ul>
            {check.errors.length > 50 && <p className="small">…and {check.errors.length - 50} more.</p>}
          </div>
        )}
        {check && check.errors.length === 0 && (
          <div className="alert ok">
            {check.ready} {check.ready === 1 ? "user is" : "users are"} ready to import. Each gets a temporary password.
          </div>
        )}
        <div className="row-wrap">
          <button className="btn" disabled={busy || !csv.trim()} onClick={() => send(true)}>
            {busy && !check ? "Checking…" : "Check file"}
          </button>
          <button className="btn btn-primary" disabled={busy || !check || check.errors.length > 0 || check.ready === 0} onClick={() => send(false)}>
            {check && check.errors.length === 0 ? `Import ${check.ready} ${check.ready === 1 ? "user" : "users"}` : "Import"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
