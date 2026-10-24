import { FormEvent, useMemo, useState } from "react";
import { Field, Select } from "../../shared/forms";
import { fmtDate } from "../../shared/format";
import { Empty, ErrorNote, Sheet, Spinner, useLoad, useToast } from "../../shared/ui";
import { api, errMsg, useAuth } from "../ctx";
import type { AdminMasterItem } from "../types";
import { PageHead } from "./common";

const LISTS: { list: string; label: string; hint: string }[] = [
  { list: "category", label: "Categories", hint: "Groups of unsafe acts and unsafe conditions." },
  { list: "item", label: "Specific observations", hint: "The items a safety officer picks inside a category." },
  { list: "hazard", label: "Hazard types", hint: "Fall from height, electrical, fire and so on." },
  { list: "activity", label: "Work activities", hint: "Linked to the SafeWorks procedures." },
  { list: "root_cause", label: "Root causes", hint: "Likely root cause chosen for each point." },
  { list: "lsr", label: "Life-Saving Rules", hint: "Rules a point can be marked as breaching." },
  { list: "immediate_action", label: "Immediate actions", hint: "What was done on the spot." },
  { list: "control_level", label: "Control levels", hint: "Hierarchy of controls for the corrective action." },
  { list: "round_type", label: "Safety walk types", hint: "Daily site walk, weekly inspection, management walk…" },
  { list: "shift", label: "Shifts", hint: "Shifts a safety walk can be recorded for." },
  { list: "permit_type", label: "Permit types", hint: "Permit-to-work types (IS 17893)." },
];

const PARENT_KIND = [
  { value: "unsafe_act", label: "Unsafe act" },
  { value: "unsafe_condition", label: "Unsafe condition" },
];

export default function MasterLists() {
  const { canWrite } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad<{ items: AdminMasterItem[] }>(() => api.get("/api/admin/master"), []);
  const [list, setList] = useState("category");
  const [parentFilter, setParentFilter] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [newParent, setNewParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<AdminMasterItem | null>(null);

  const items = data?.items ?? [];
  const categories = useMemo(() => items.filter((i) => i.list === "category"), [items]);
  const catLabel = (code: string | null) => (code ? PARENT_KIND.find((p) => p.value === code)?.label ?? categories.find((c) => c.code === code)?.label ?? code : "");
  const rows = items.filter((i) => i.list === list && (!parentFilter || i.parent === parentFilter) && (showInactive || i.active));
  const meta = LISTS.find((l) => l.list === list)!;
  const needsParent = list === "item" || list === "category";
  const parentOptions = list === "item" ? categories.filter((c) => c.active).map((c) => ({ value: c.code, label: `${c.label} (${catLabel(c.parent)})` })) : PARENT_KIND;

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      reload();
      return true;
    } catch (e) {
      toast(errMsg(e), true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (needsParent && !newParent) return toast(list === "item" ? "Choose the category this item belongs to." : "Choose unsafe act or unsafe condition.", true);
    const ok = await run(() => api.post("/api/admin/master", { list, label: newLabel.trim(), parent: needsParent ? newParent : null }), "Item added");
    if (ok) setNewLabel("");
  }

  return (
    <div>
      <PageHead
        title="Master lists"
        sub="The pick-lists used when raising an observation. Changes create a new list version; observations already raised keep the wording they were raised with."
      />
      <div className="subnav" role="tablist" aria-label="Lists">
        {LISTS.map((l) => (
          <button
            key={l.list}
            role="tab"
            aria-selected={l.list === list}
            className="chip"
            aria-pressed={l.list === list}
            onClick={() => {
              setList(l.list);
              setParentFilter("");
              setNewParent("");
            }}
          >
            {l.label}
          </button>
        ))}
      </div>
      <ErrorNote error={error} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="stack">
          <p className="muted">{meta.hint}</p>
          {canWrite && (
            <form className="section stack" onSubmit={add} aria-label={`Add to ${meta.label}`}>
              <h3>Add to {meta.label.toLowerCase()}</h3>
              <div className="filters" style={{ marginBottom: 0 }}>
                {needsParent && (
                  <div className="field">
                    <label htmlFor="m-parent">{list === "item" ? "Category" : "Applies to"}</label>
                    <Select id="m-parent" value={newParent} onChange={setNewParent} options={parentOptions} placeholder="Choose…" />
                  </div>
                )}
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label htmlFor="m-label">Label</label>
                  <input id="m-label" className="input" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} minLength={2} maxLength={300} required />
                </div>
                <button className="btn btn-primary" disabled={busy || newLabel.trim().length < 2}>
                  Add
                </button>
              </div>
            </form>
          )}
          <div className="row-wrap">
            {list === "item" && (
              <div className="field" style={{ minWidth: 260 }}>
                <label htmlFor="m-filter">Show category</label>
                <Select
                  id="m-filter"
                  value={parentFilter}
                  onChange={setParentFilter}
                  placeholder="All categories"
                  options={categories.map((c) => ({ value: c.code, label: `${c.label} (${catLabel(c.parent)})` }))}
                />
              </div>
            )}
            <label className="checkline" style={{ alignSelf: "flex-end" }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              <span>Show inactive items</span>
            </label>
          </div>
          {rows.length === 0 ? (
            <div className="section">
              <Empty title="Nothing in this list yet">{canWrite && <p>Add the first item above.</p>}</Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Label</th>
                    {needsParent && <th>{list === "item" ? "Category" : "Applies to"}</th>}
                    <th>Code</th>
                    <th>Version</th>
                    <th>Source</th>
                    <th>Status</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id} className={i.active ? "" : "inactive"}>
                      <td>{i.label}</td>
                      {needsParent && <td className="small">{catLabel(i.parent)}</td>}
                      <td className="code small">{i.code}</td>
                      <td className="small">
                        {i.version}
                        {i.custom && <div className="muted">{fmtDate(i.updatedAt)}</div>}
                      </td>
                      <td className="small">{i.custom ? "Company" : "Built-in"}</td>
                      <td>{i.active ? <span className="state-tag ok">Active</span> : <span className="state-tag off">Inactive</span>}</td>
                      {canWrite && (
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setRenaming(i)}>
                            Rename
                          </button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => api.patch(`/api/admin/master/${i.id}`, { active: !i.active }), i.active ? "Item deactivated" : "Item reactivated")}>
                            {i.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {renaming && (
        <RenameSheet
          item={renaming}
          busy={busy}
          onClose={() => setRenaming(null)}
          onSave={async (label) => {
            const ok = await run(() => api.patch(`/api/admin/master/${renaming.id}`, { label }), "Item renamed");
            if (ok) setRenaming(null);
          }}
        />
      )}
    </div>
  );
}

function RenameSheet({ item, busy, onClose, onSave }: { item: AdminMasterItem; busy: boolean; onClose: () => void; onSave: (label: string) => void }) {
  const [label, setLabel] = useState(item.label);
  return (
    <Sheet title="Rename list item" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(label.trim());
        }}
      >
        <Field label="Label" htmlFor="rn">
          <textarea id="rn" className="textarea" style={{ minHeight: 72 }} value={label} onChange={(e) => setLabel(e.target.value)} minLength={2} maxLength={300} required />
        </Field>
        <p className="small muted">
          {item.custom ? "" : "This is a built-in item: your company gets its own copy with the new wording. "}
          Observations already raised keep the old wording.
        </p>
        <button className="btn btn-primary btn-block" disabled={busy || label.trim().length < 2 || label.trim() === item.label}>
          Save
        </button>
      </form>
    </Sheet>
  );
}
