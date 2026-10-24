import { FormEvent, useState } from "react";
import { Field, Select } from "../../shared/forms";
import { IconPlus } from "../../shared/icons";
import { Empty, ErrorNote, Sheet, Spinner, useToast } from "../../shared/ui";
import { api, errMsg, useAuth } from "../ctx";
import { AdminSite, SITE_TYPES, STATES } from "../types";
import { PageHead, useAdminSites } from "./common";

const typeLabel = (t: string) => SITE_TYPES.find((x) => x.value === t)?.label ?? t;

export default function Sites() {
  const { canWrite } = useAuth();
  const { data, error, loading, reload } = useAdminSites();
  const [editing, setEditing] = useState<AdminSite | "new" | null>(null);

  const sites = data?.sites ?? [];
  const current = editing && editing !== "new" ? sites.find((s) => s.id === editing.id) ?? editing : editing;

  return (
    <div>
      <PageHead
        title="Sites & areas"
        sub="Each construction site, factory or plant, with the areas where observations are made. Deactivated sites keep their records."
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              <IconPlus size={18} /> Add site
            </button>
          )
        }
      />
      <ErrorNote error={error} />
      {loading && !data && <Spinner />}
      {data && sites.length === 0 && (
        <div className="section">
          <Empty title="No sites yet">
            <p>Add your first site to start raising observations.</p>
          </Empty>
        </div>
      )}
      {sites.length > 0 && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Site</th>
                <th>Code</th>
                <th>Type</th>
                <th>State</th>
                <th>Site head</th>
                <th className="r">Areas</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} className={`click ${s.active ? "" : "inactive"}`} tabIndex={0} onClick={() => setEditing(s)} onKeyDown={(e) => e.key === "Enter" && setEditing(s)}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.address && <div className="small muted">{s.address}</div>}
                  </td>
                  <td>
                    <span className="code">{s.code}</span>
                  </td>
                  <td>{typeLabel(s.siteType)}</td>
                  <td>{s.state}</td>
                  <td>
                    {s.siteHeadName || <span className="muted">Not set</span>}
                    {s.siteHeadPhone && <div className="small muted">{s.siteHeadPhone}</div>}
                  </td>
                  <td className="r">{s.areas.filter((a) => a.active).length}</td>
                  <td>{s.active ? <span className="state-tag ok">Active</span> : <span className="state-tag off">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current && (
        <SiteSheet
          key={current === "new" ? "new" : `${current.id}-${current.code ? "ready" : "loading"}`}
          site={current === "new" ? null : current}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            reload();
            if (id) setEditing({ id } as AdminSite);
          }}
        />
      )}
    </div>
  );
}

function SiteSheet({ site, canWrite, onClose, onSaved }: { site: AdminSite | null; canWrite: boolean; onClose: () => void; onSaved: (newId?: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    code: site?.code ?? "",
    name: site?.name ?? "",
    siteType: site?.siteType ?? "construction",
    state: site?.state ?? "Karnataka",
    address: site?.address ?? "",
    siteHeadName: site?.siteHeadName ?? "",
    siteHeadPhone: site?.siteHeadPhone ?? "",
    siteHeadEmail: site?.siteHeadEmail ?? "",
    active: site?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const loadingExisting = site && !site.code; // placeholder object right after create

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (site) {
        await api.patch(`/api/admin/sites/${site.id}`, f);
        toast("Site saved");
        onSaved();
      } else {
        const r = await api.post<{ id: string }>("/api/admin/sites", f);
        toast("Site added. Now add its areas.");
        onSaved(r.id);
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (loadingExisting) {
    return (
      <Sheet title="Site" onClose={onClose}>
        <Spinner />
      </Sheet>
    );
  }

  return (
    <Sheet title={site ? `${site.name}` : "Add site"} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={!canWrite} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <div className="grid-2">
            <Field label="Site name" required htmlFor="s-name">
              <input id="s-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} required minLength={2} />
            </Field>
            <Field label="Site code" required htmlFor="s-code" hint="Used in observation IDs, e.g. OBS-BLR-TWR01-2026-00012. 2–20 letters, digits or dashes.">
              <input
                id="s-code"
                className="input code"
                value={f.code}
                onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                required
                minLength={2}
                maxLength={20}
              />
            </Field>
            <Field label="Type" htmlFor="s-type">
              <Select id="s-type" value={f.siteType} onChange={(v) => set("siteType", v || "construction")} options={SITE_TYPES} placeholder="Choose type" />
            </Field>
            <Field label="State" htmlFor="s-state" hint="Decides which state rules the app suggests (Tamil Nadu or Karnataka factories rules, and so on).">
              <input id="s-state" className="input" list="states" value={f.state} onChange={(e) => set("state", e.target.value)} required />
              <datalist id="states">
                {STATES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Address" htmlFor="s-addr">
            <textarea id="s-addr" className="textarea" style={{ minHeight: 64 }} value={f.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <div className="grid-2">
            <Field label="Site head name" htmlFor="s-hn">
              <input id="s-hn" className="input" value={f.siteHeadName} onChange={(e) => set("siteHeadName", e.target.value)} />
            </Field>
            <Field label="Site head phone" htmlFor="s-hp">
              <input id="s-hp" className="input" type="tel" value={f.siteHeadPhone} onChange={(e) => set("siteHeadPhone", e.target.value)} />
            </Field>
          </div>
          <Field label="Site head email" htmlFor="s-he" hint="Gets the escalation email when a point is overdue past the set number of days.">
            <input id="s-he" className="input" type="email" value={f.siteHeadEmail} onChange={(e) => set("siteHeadEmail", e.target.value)} />
          </Field>
          {site && (
            <label className="checkline">
              <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} />
              <span>
                Site is active
                <br />
                <span className="small muted">Inactive sites disappear from the app; their observations stay in reports.</span>
              </span>
            </label>
          )}
        </fieldset>
        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        {canWrite && (
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Saving…" : site ? "Save site" : "Add site"}
          </button>
        )}
      </form>
      {site && <AreasEditor site={site} canWrite={canWrite} onChanged={() => onSaved()} />}
    </Sheet>
  );
}

function AreasEditor({ site, canWrite, onChanged }: { site: AdminSite; canWrite: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onChanged();
    } catch (e) {
      toast(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-section" style={{ marginTop: 18 }}>
      <h3>Areas / zones</h3>
      <p className="small muted" style={{ marginBottom: 8 }}>
        Where on the site an observation was made, e.g. Block A L3, Paint shop, Tank farm dyke 2.
      </p>
      {site.areas.length === 0 && <p className="small muted">No areas yet.</p>}
      <div>
        {site.areas.map((a) => (
          <div className="area-row" key={a.id}>
            {renaming?.id === a.id ? (
              <form
                className="row grow"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = renaming.name.trim();
                  if (n) void run(() => api.patch(`/api/admin/areas/${a.id}`, { name: n }), "Area renamed").then(() => setRenaming(null));
                }}
              >
                <input className="input grow" aria-label="Area name" value={renaming.name} onChange={(e) => setRenaming({ id: a.id, name: e.target.value })} autoFocus />
                <button className="btn btn-sm" disabled={busy}>
                  Save
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="grow" style={a.active ? undefined : { color: "var(--muted)", textDecoration: "line-through" }}>
                  {a.name}
                </span>
                {canWrite && (
                  <>
                    <button className="btn btn-sm btn-ghost" onClick={() => setRenaming({ id: a.id, name: a.name })}>
                      Rename
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={() => run(() => api.patch(`/api/admin/areas/${a.id}`, { active: !a.active }), a.active ? "Area deactivated" : "Area reactivated")}
                    >
                      {a.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {canWrite && (
        <form
          className="row"
          style={{ marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            void run(() => api.post(`/api/admin/sites/${site.id}/areas`, { name: n }), "Area added").then(() => setName(""));
          }}
        >
          <input className="input grow" placeholder="New area name" aria-label="New area name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={busy || !name.trim()}>
            Add area
          </button>
        </form>
      )}
    </div>
  );
}
