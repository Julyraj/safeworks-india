/* Departments (2.1): one company-wide list (Civil, Electrical, Maintenance, HSE, Stores …). Each user belongs to at most
   one; an action takes its owner's department when it is assigned, and named reports take the reporter's. Removing a
   department takes it off its members; past actions and reports keep the department they were recorded with. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { Department, I18n } from "../../shared/types";
import { Button, DataTable, EmptyState, ErrorCard, Field, Input, Pill, SearchEmpty, Sheet, Toggle, useToast, type Column } from "../../shared/ui";
import { IconPlus, IconUsers, IconEdit, IconTrash } from "../../shared/icons";
import { useLoad } from "../../shared/hooks";
import { api, errMessage, localCsv } from "../api";
import { useAuth } from "../auth";
import { ExportButton } from "../components";

export function useDepartments() {
  return useLoad(() => api.get<Department[]>("/admin/departments"), []);
}

export function DepartmentsTab() {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const state = useDepartments();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<Department> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canEdit = perms.isAdmin && !perms.readOnly;
  const all = state.data ?? [];
  const rows = all.filter((d) => !hidden.has(d.id) && (!q || `${d.code} ${Object.values(d.name).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const unhide = (id: string) => setHidden((h) => { const n = new Set(h); n.delete(id); return n; });
  const remove = (d: Department) => {
    setHidden((h) => new Set(h).add(d.id));
    toast.undoable(t("departments.removed", { name: pick(d.name) }), async () => { try { await api.del(`/admin/departments/${d.id}`); state.reload(); } catch (e) { toast.error(errMessage(e)); } unhide(d.id); }, () => unhide(d.id));
  };
  const blank = (): Partial<Department> => ({ code: "", name: { en: "" }, sort: (all.at(-1)?.sort ?? 0) + 1, active: true });
  const columns: Column<Department>[] = [
    { key: "name", label: t("departments.name"), render: (d) => <div><div className="cell-title">{pick(d.name)}</div><div className="cell-sub">{d.code}</div></div> },
    { key: "members", label: t("departments.members"), render: (d) => d.memberCount ?? 0, width: 110 },
    { key: "active", label: t("common.status"), render: (d) => <Pill tone={d.active ? "green" : "grey"}>{d.active ? t("sites.active") : t("sites.inactive")}</Pill>, width: 90 },
    { key: "tools", label: "", render: (d) => canEdit ? <span className="row-actions"><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); setEdit(d); }} aria-label={t("common.edit")}><IconEdit size={14} /></Button><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); remove(d); }} aria-label={t("common.remove")}><IconTrash size={14} /></Button></span> : null, width: 80 },
  ];
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{t("departments.intro")}</p>
      <div className="filters">
        <div className="field grow-search"><label>{t("common.search")}</label><Input data-register-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("departments.searchPh")} /></div>
        <div className="end">
          <ExportButton onExport={async () => localCsv(rows.map((d) => ({ code: d.code, name_en: d.name.en, name_hi: d.name.hi ?? "", name_ta: d.name.ta ?? "", name_kn: d.name.kn ?? "", members: d.memberCount ?? 0, active: d.active })), "departments.csv")} />
          {canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit(blank())} data-testid="department-add"><IconPlus size={14} />{t("departments.add")}</Button> : null}
        </div>
      </div>
      {state.error ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(d) => d.id} loading={!state.data && !state.error} onRow={canEdit ? (d) => setEdit(d) : undefined}
        empty={q ? <SearchEmpty q={q} onClear={() => setQ("")} /> : <EmptyState icon={<IconUsers />} title={t("departments.empty")} body={t("departments.emptyHint")} action={canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit(blank())}>{t("departments.add")}</Button> : undefined} />} />
      {edit ? <DepartmentSheet d={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} /> : null}
    </div>
  );
}

function DepartmentSheet({ d, onClose, onSaved }: { d: Partial<Department>; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState<Partial<Department>>(d);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setF(d), [d]);
  const name: I18n = f.name ?? { en: "" };
  const setName = (k: keyof I18n, v: string) => setF({ ...f, name: { ...name, [k]: v } });
  const codeOk = /^[A-Za-z0-9_-]{1,20}$/.test(f.code ?? "");
  const valid = codeOk && !!name.en.trim();
  const save = async () => {
    setBusy(true); setErr("");
    const body = { code: f.code, name, sort: f.sort ?? 0, active: f.active !== false };
    try { if (d.id) await api.put(`/admin/departments/${d.id}`, body); else await api.post("/admin/departments", body); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={d.id ? `${t("common.edit")} · ${d.name?.en ?? ""}` : t("departments.add")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={save}>{t("common.save")}</Button></>}>
      <div className="form-grid">
        <Field label={t("departments.code")} required hint={t("departments.codeHint")} error={f.code && !codeOk ? t("departments.codeBad") : undefined}><Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} autoFocus /></Field>
        <Field label={`${t("departments.name")} (English)`} required><Input value={name.en} onChange={(e) => setName("en", e.target.value)} maxLength={120} /></Field>
        <Field label={`${t("departments.name")} (हिन्दी)`} optional><Input value={name.hi ?? ""} onChange={(e) => setName("hi", e.target.value)} maxLength={120} /></Field>
        <Field label={`${t("departments.name")} (தமிழ்)`} optional><Input value={name.ta ?? ""} onChange={(e) => setName("ta", e.target.value)} maxLength={120} /></Field>
        <Field label={`${t("departments.name")} (ಕನ್ನಡ)`} optional><Input value={name.kn ?? ""} onChange={(e) => setName("kn", e.target.value)} maxLength={120} /></Field>
        <Field label={t("departments.sort")}><Input type="number" value={String(f.sort ?? 0)} onChange={(e) => setF({ ...f, sort: Number(e.target.value) || 0 })} /></Field>
      </div>
      {d.id ? <Toggle label={t("sites.active")} checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} /> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

export default DepartmentsTab;
