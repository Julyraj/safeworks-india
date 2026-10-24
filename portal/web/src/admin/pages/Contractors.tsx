import { FormEvent, useState } from "react";
import { Field } from "../../shared/forms";
import { IconPlus } from "../../shared/icons";
import { Empty, ErrorNote, Sheet, Spinner, useToast } from "../../shared/ui";
import { api, errMsg, useAuth } from "../ctx";
import type { AdminContractor, AdminSite } from "../types";
import { PageHead, useAdminSites, useContractors } from "./common";

export default function Contractors() {
  const { canWrite } = useAuth();
  const { data, error, loading, reload } = useContractors();
  const sites = useAdminSites();
  const [editing, setEditing] = useState<AdminContractor | "new" | null>(null);
  const siteById = new Map((sites.data?.sites ?? []).map((s) => [s.id, s]));

  return (
    <div>
      <PageHead
        title="Contractors"
        sub="Contractor companies working on your sites. Observations and supervisors can be linked to them for the contractor scorecard."
        actions={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setEditing("new")} disabled={!sites.data}>
              <IconPlus size={18} /> Add contractor
            </button>
          )
        }
      />
      <ErrorNote error={error} />
      {loading && !data && <Spinner />}
      {data && data.contractors.length === 0 && (
        <div className="section">
          <Empty title="No contractors yet">
            <p>Add the companies working on your sites so safety officers can pick them when raising a point.</p>
          </Empty>
        </div>
      )}
      {data && data.contractors.length > 0 && (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Sites</th>
                <th className="r">Users</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.contractors.map((c) => (
                <tr key={c.id} className={`click ${c.active ? "" : "inactive"}`} tabIndex={0} onClick={() => setEditing(c)} onKeyDown={(e) => e.key === "Enter" && setEditing(c)}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td className="small">{c.contact || <span className="muted">—</span>}</td>
                  <td className="small">
                    {c.siteIds.length === 0 ? <span className="muted">No sites</span> : c.siteIds.map((id) => siteById.get(id)?.code ?? "?").join(", ")}
                  </td>
                  <td className="r">{c.users}</td>
                  <td>{c.active ? <span className="state-tag ok">Active</span> : <span className="state-tag off">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && sites.data && (
        <ContractorSheet
          contractor={editing === "new" ? null : editing}
          sites={sites.data.sites}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reload();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ContractorSheet({ contractor, sites, canWrite, onClose, onSaved }: { contractor: AdminContractor | null; sites: AdminSite[]; canWrite: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(contractor?.name ?? "");
  const [contact, setContact] = useState(contractor?.contact ?? "");
  const [active, setActive] = useState(contractor?.active ?? true);
  const [siteIds, setSiteIds] = useState<string[]>(contractor?.siteIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name, contact, active, siteIds };
      if (contractor) await api.put(`/api/admin/contractors/${contractor.id}`, body);
      else await api.post("/api/admin/contractors", body);
      toast(contractor ? "Contractor saved" : "Contractor added");
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setSiteIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <Sheet title={contractor ? contractor.name : "Add contractor"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <fieldset disabled={!canWrite} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <Field label="Company name" required htmlFor="c-name">
            <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </Field>
          <Field label="Contact" htmlFor="c-contact" hint="Person, phone or email for the contractor's safety lead.">
            <input id="c-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <div className="field">
            <span className="label">Works on these sites</span>
            {sites.length === 0 ? (
              <p className="small muted">Add sites first.</p>
            ) : (
              <div className="checkgrid">
                {sites.map((s) => (
                  <label className="checkline" key={s.id}>
                    <input type="checkbox" checked={siteIds.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span>
                      {s.name} <span className="small muted code">{s.code}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {contractor && (
            <label className="checkline">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Contractor is active</span>
            </label>
          )}
        </fieldset>
        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        {canWrite && (
          <button className="btn btn-primary btn-block" disabled={busy || name.trim().length < 2}>
            {busy ? "Saving…" : contractor ? "Save contractor" : "Add contractor"}
          </button>
        )}
      </form>
    </Sheet>
  );
}
