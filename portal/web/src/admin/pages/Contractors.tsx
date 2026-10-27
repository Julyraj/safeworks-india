/* Contractors (employers): CRUD with site assignment, trades, registration, contact. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { Contractor } from "../../shared/types";
import { Button, DataTable, EmptyState, ErrorCard, Field, Input, Pill, SearchEmpty, Sheet, Toggle, useToast, type Column } from "../../shared/ui";
import { IconPlus, IconUsers, IconEdit, IconTrash } from "../../shared/icons";
import { api, errMessage, localCsv } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { ChipsSelect, ExportButton } from "../components";

const TRADES = ["civil", "steel_fixing", "shuttering", "scaffolding", "electrical", "welding", "painting", "plumbing", "rigging", "operators", "housekeeping", "security", "other"];

export function ContractorsTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { contractors, reload, siteId, siteName, sites } = useScope();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<Contractor> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canEdit = perms.isAdmin && !perms.readOnly;
  const rows = contractors.data.filter((c) => !hidden.has(c.id) && (!siteId || c.isOwnCompany || c.siteIds.includes(siteId)) && (!q || `${c.name} ${c.registrationNo} ${c.contactName}`.toLowerCase().includes(q.toLowerCase())));
  const remove = (c: Contractor) => {
    setHidden((h) => new Set(h).add(c.id));
    toast.undoable(t("contractors.removed", { name: c.name }), async () => { try { await api.del(`/admin/contractors/${c.id}`); await reload("contractors"); } catch (e) { toast.error(errMessage(e)); } setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }); }, () => setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }));
  };
  const blank = (): Partial<Contractor> => ({ name: "", isOwnCompany: false, parentId: null, registrationNo: "", contactName: "", phone: "", email: "", trades: [], siteIds: siteId ? [siteId] : [], active: true });
  const columns: Column<Contractor>[] = [
    { key: "name", label: t("contractors.name"), render: (c) => <div><div className="cell-title">{c.name} {c.isOwnCompany ? <Pill tone="hivis">{t("common.ownCompany")}</Pill> : null}</div><div className="cell-sub">{c.registrationNo}{c.parentId ? ` · ${t("contractors.subOf", { name: contractors.data.find((x) => x.id === c.parentId)?.name ?? "" })}` : ""}</div></div> },
    { key: "contact", label: t("contractors.contact"), render: (c) => <div>{c.contactName}<div className="cell-sub">{c.phone}{c.email ? ` · ${c.email}` : ""}</div></div>, width: 200 },
    { key: "trades", label: t("contractors.trades"), render: (c) => c.trades.map((x) => t(`trade.${x}`)).join(", ") || "—" },
    { key: "sites", label: t("nav.sites"), render: (c) => c.isOwnCompany ? t("role.allSites") : c.siteIds.map((s) => sites.find((x) => x.id === s)?.code ?? siteName(s)).join(", ") || "—", width: 160 },
    { key: "active", label: t("common.status"), render: (c) => <Pill tone={c.active ? "green" : "grey"}>{c.active ? t("sites.active") : t("sites.inactive")}</Pill>, width: 90 },
    { key: "tools", label: "", render: (c) => canEdit ? <span className="row-actions"><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); setEdit(c); }} aria-label={t("common.edit")}><IconEdit size={14} /></Button>{!c.isOwnCompany ? <Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); remove(c); }} aria-label={t("common.remove")}><IconTrash size={14} /></Button> : null}</span> : null, width: 80 },
  ];
  return (
    <div className="stack">
      <div className="filters">
        <div className="field grow-search"><label>{t("common.search")}</label><Input data-register-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("contractors.searchPh")} /></div>
        <div className="end">
          <ExportButton onExport={async () => localCsv(rows.map((c) => ({ name: c.name, registration: c.registrationNo, contact: c.contactName, phone: c.phone, email: c.email, trades: c.trades.join("|"), sites: c.siteIds.map((s) => sites.find((x) => x.id === s)?.code ?? s).join("|"), active: c.active })), "contractors.csv")} />
          {canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit(blank())}><IconPlus size={14} />{t("contractors.add")}</Button> : null}
        </div>
      </div>
      {contractors.error ? <ErrorCard error={contractors.error} onRetry={() => reload("contractors")} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} loading={!contractors.loaded} onRow={canEdit ? (c) => setEdit(c) : undefined}
        empty={q ? <SearchEmpty q={q} onClear={() => setQ("")} /> : <EmptyState icon={<IconUsers />} title={t("contractors.empty")} body={t("contractors.emptyHint")} action={canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit(blank())}>{t("contractors.add")}</Button> : undefined} />} />
      {edit ? <ContractorSheet c={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload("contractors"); }} /> : null}
    </div>
  );
}

function ContractorSheet({ c, onClose, onSaved }: { c: Partial<Contractor>; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { sites, contractors } = useScope();
  const [f, setF] = useState<Partial<Contractor>>(c);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setF(c), [c]);
  const emailBad = !!f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  const valid = !!f.name?.trim() && !emailBad;
  return (
    <Sheet title={c.id ? `${t("common.edit")} · ${c.name}` : t("contractors.add")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try { if (c.id) await api.put(`/admin/contractors/${c.id}`, f); else await api.post("/admin/contractors", f); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>{t("common.save")}</Button></>}>
      <div className="form-grid">
        <Field label={t("contractors.name")} required><Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} autoFocus /></Field>
        <Field label={t("contractors.registration")} optional><Input value={f.registrationNo ?? ""} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} maxLength={60} /></Field>
        <Field label={t("contractors.contact")}><Input value={f.contactName ?? ""} onChange={(e) => setF({ ...f, contactName: e.target.value })} maxLength={80} /></Field>
        <Field label={t("users.phone")}><Input value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" maxLength={20} /></Field>
        <Field label={t("users.email")} error={emailBad ? t("users.emailBad") : undefined}><Input type="email" value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t("contractors.parent")} hint={t("contractors.parentHint")}><select className="select" value={f.parentId ?? ""} onChange={(e) => setF({ ...f, parentId: e.target.value || null })}><option value="">—</option>{contractors.data.filter((x) => x.id !== c.id && !x.isOwnCompany).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      </div>
      <Field label={t("contractors.trades")}><ChipsSelect ariaLabel={t("contractors.trades")} options={TRADES.map((x) => ({ value: x, label: t(`trade.${x}`) }))} value={f.trades ?? []} onChange={(v) => setF({ ...f, trades: v })} /></Field>
      {!f.isOwnCompany ? <Field label={t("contractors.sites")} hint={t("contractors.sitesHint")}><ChipsSelect ariaLabel={t("contractors.sites")} options={sites.map((s) => ({ value: s.id, label: `${s.code} · ${pick(s.name)}` }))} value={f.siteIds ?? []} onChange={(v) => setF({ ...f, siteIds: v })} /></Field> : null}
      {c.id ? <Toggle label={t("sites.active")} checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} /> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

export default ContractorsTab;
