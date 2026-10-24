import { FormEvent, useEffect, useState } from "react";
import { fmtDateTime } from "../../shared/format";
import { Empty, ErrorNote, Spinner } from "../../shared/ui";
import { api, errMsg } from "../ctx";
import type { AuditItem } from "../types";
import { PageHead } from "./common";

const ACTIONS = [
  { value: "", label: "All actions" },
  { value: "login", label: "Sign-ins and lockouts" },
  { value: "password", label: "Passwords" },
  { value: "user", label: "Users and roles" },
  { value: "site", label: "Sites" },
  { value: "area", label: "Areas" },
  { value: "contractor", label: "Contractors" },
  { value: "master", label: "Master lists" },
  { value: "settings", label: "Settings" },
  { value: "export", label: "Exports" },
  { value: "observation", label: "Observations" },
];

const ACTION_TEXT: Record<string, string> = {
  login: "Signed in",
  "login.failed": "Sign-in failed",
  "login.locked": "Locked after wrong passwords",
  "login.denied_admin": "Admin console refused",
  "password.changed": "Changed own password",
  "password.reset": "Reset to temporary password",
  "password.set_by_admin": "Password set by admin",
  "password.force_change": "Asked to change password",
  "user.created": "User created",
  "user.updated": "User details changed",
  "user.roles_changed": "Roles changed",
  "user.unlocked": "Account unlocked",
  "user.deactivated": "User deactivated",
  "user.reactivated": "User reactivated",
  "user.bulk_import": "Users imported",
  "site.created": "Site added",
  "site.updated": "Site changed",
  "area.created": "Area added",
  "area.updated": "Area changed",
  "contractor.created": "Contractor added",
  "contractor.updated": "Contractor changed",
  "master.created": "List item added",
  "master.updated": "List item changed",
  "settings.updated": "Settings changed",
  "export.observations": "Observations exported",
  "observation.closed_on_spot": "Corrected on the spot",
};

function summary(d: Record<string, unknown>): string {
  if (!d || typeof d !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === "before" || k === "after") continue;
    if (v === null || v === undefined || v === "") continue;
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    parts.push(`${k}: ${val}`);
  }
  if ("after" in d) parts.push("before/after recorded");
  const s = parts.join(" · ");
  return s.length > 220 ? s.slice(0, 220) + "…" : s;
}

export default function Audit() {
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AuditItem[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  async function load(p: number, append: boolean) {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ items: AuditItem[] }>("/api/admin/audit", { action: action || undefined, q: query || undefined, page: p });
      setItems((cur) => (append ? [...cur, ...r.items] : r.items));
      setMore(r.items.length === 100);
      setPage(p);
    } catch (e) {
      setError(new Error(errMsg(e)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, query]);

  return (
    <div>
      <PageHead title="Audit log" sub="Who did what and when: sign-ins, password resets, role changes, settings, exports." />
      <div className="filters" role="search">
        <div className="field">
          <label htmlFor="a-act">Action</label>
          <select id="a-act" className="select" value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <form
          className="field"
          style={{ gridColumn: "span 2" }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <label htmlFor="a-q">Search</label>
          <div className="row">
            <input id="a-q" className="input grow" placeholder="Name, employee ID or detail" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn">Search</button>
          </div>
        </form>
      </div>
      <ErrorNote error={error} />
      {loading && items.length === 0 && <Spinner />}
      {!loading && items.length === 0 && !error && (
        <div className="section">
          <Empty title="No entries">
            <p>Try another action or search.</p>
          </Empty>
        </div>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
                <th>IP address</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>
                    {fmtDateTime(a.at)}
                  </td>
                  <td className="small">
                    {a.actor ?? <span className="muted">Unknown</span>}
                    {a.actorEmployeeId && <div className="muted code">{a.actorEmployeeId}</div>}
                  </td>
                  <td>
                    <span style={a.action.startsWith("login.failed") || a.action === "login.locked" ? { color: "var(--red)", fontWeight: 600 } : undefined}>
                      {ACTION_TEXT[a.action] ?? a.action}
                    </span>
                    {a.entity && <div className="small muted">{a.entity}</div>}
                  </td>
                  <td className="details-cell">{summary(a.details)}</td>
                  <td className="small">{a.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <div style={{ marginTop: 12 }}>
          <button className="btn" disabled={loading} onClick={() => load(page + 1, true)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
