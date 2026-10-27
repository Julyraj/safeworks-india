/* People (workers directory without logins) and contractors in one screen with tabs. CRUD, site assignment, CSV import with preview. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { ImportResult, Lang, Person, ReporterType } from "../../shared/types";
import { Button, DataTable, EmptyState, ErrorCard, Field, Input, Pagination, Pill, SearchEmpty, Select, Sheet, Tabs, Toggle, useToast, type Column } from "../../shared/ui";
import { IconHelmet, IconPlus, IconEdit, IconTrash } from "../../shared/icons";
import { api, errMessage, localCsv } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { CountLine, CsvImport, ExportButton, FilterSelect, PageHead, RegisterSearch, SavedFilters, langOptions, useRegister } from "../components";
import { ContractorsTab } from "./Contractors";

const WORKER_TYPES: ReporterType[] = ["employee", "contractor", "temporary", "visitor"];
type PersonAdmin = Person & { siteIds?: string[]; phone?: string };

export default function People({ tab: initial = "people" }: { tab?: "people" | "contractors" }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { siteId, siteName } = useScope();
  const tab = initial;
  return (
    <>
      <PageHead title={t("nav.people")} sub={siteId ? siteName(siteId) : t("top.allSites")} />
      <Tabs value={tab} onChange={(v) => nav(v === "people" ? "/people" : "/contractors")} tabs={[{ value: "people", label: t("people.tab") }, { value: "contractors", label: t("contractors.tab") }]} />
      <div style={{ marginTop: 14 }}>{tab === "people" ? <PeopleTab /> : <ContractorsTab />}</div>
    </>
  );
}

function PeopleTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { contractors, siteId, sites } = useScope();
  const reg = useRegister<PersonAdmin>("people", "/admin/people");
  const [edit, setEdit] = useState<Partial<PersonAdmin> | null>(null);
  const [importing, setImporting] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canEdit = (perms.isAdmin || perms.canTriage) && !perms.readOnly;
  const rows = (reg.data?.items ?? []).filter((p) => !hidden.has(p.id));
  const remove = (p: PersonAdmin) => {
    setHidden((h) => new Set(h).add(p.id));
    toast.undoable(t("people.removed", { name: p.fullName }), async () => { try { await api.del(`/admin/people/${p.id}`); reg.reload(); } catch (e) { toast.error(errMessage(e)); } setHidden((h) => { const n = new Set(h); n.delete(p.id); return n; }); }, () => setHidden((h) => { const n = new Set(h); n.delete(p.id); return n; }));
  };
  const blank = (): Partial<PersonAdmin> => ({ fullName: "", employerId: null, phone: "", preferredLanguage: "en", trade: "", workerType: "employee", active: true, siteIds: siteId ? [siteId] : [] });
  const columns: Column<PersonAdmin>[] = [
    { key: "fullName", label: t("people.name"), render: (p) => <div><div className="cell-title">{p.fullName}</div><div className="cell-sub">{p.phoneMasked}</div></div> },
    { key: "employer", label: t("common.employer"), render: (p) => p.employerId ? contractors.data.find((c) => c.id === p.employerId)?.name ?? "—" : t("common.ownCompany"), width: 180 },
    { key: "trade", label: t("common.trade"), render: (p) => p.trade ? t(`trade.${p.trade}`) === `trade.${p.trade}` ? p.trade : t(`trade.${p.trade}`) : "—", width: 130 },
    { key: "workerType", label: t("people.workerType"), render: (p) => t(`obs.reporterType.${p.workerType}`), width: 120 },
    { key: "lang", label: t("common.language"), render: (p) => langOptions.find((l) => l.value === p.preferredLanguage)?.label ?? p.preferredLanguage, width: 100 },
    { key: "active", label: t("common.status"), render: (p) => <Pill tone={p.active ? "green" : "grey"}>{p.active ? t("sites.active") : t("sites.inactive")}</Pill>, width: 90 },
    { key: "tools", label: "", render: (p) => canEdit ? <span className="row-actions"><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); setEdit(p); }} aria-label={t("common.edit")}><IconEdit size={14} /></Button><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); remove(p); }} aria-label={t("common.remove")}><IconTrash size={14} /></Button></span> : null, width: 80 },
  ];
  return (
    <div className="stack">
      <div className="filters">
        <RegisterSearch reg={reg} placeholder={t("people.searchPh")} />
        <FilterSelect label={t("common.employer")} value={reg.filters.employerId ?? ""} onChange={(v) => reg.setFilter("employerId", v)} options={contractors.data.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label={t("people.workerType")} value={reg.filters.workerType ?? ""} onChange={(v) => reg.setFilter("workerType", v)} options={WORKER_TYPES.map((w) => ({ value: w, label: t(`obs.reporterType.${w}`) }))} />
        <div className="end">
          <ExportButton onExport={async () => localCsv(rows.map((p) => ({ name: p.fullName, phone: p.phoneMasked, employer: p.employerId ? contractors.data.find((c) => c.id === p.employerId)?.name ?? "" : "", trade: p.trade, worker_type: p.workerType, language: p.preferredLanguage, active: p.active })), "people.csv")} />
          {canEdit ? <><Button size="sm" onClick={() => setImporting(true)}>{t("csv.importCsv")}</Button><Button size="sm" variant="primary" onClick={() => setEdit(blank())}><IconPlus size={14} />{t("people.add")}</Button></> : null}
        </div>
      </div>
      <SavedFilters reg={reg} />
      {reg.error && !reg.data ? <ErrorCard error={reg.error} onRetry={reg.reload} /> : null}
      <CountLine total={reg.data?.total} loading={reg.loading} />
      <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} loading={reg.loading} onRow={canEdit ? (p) => setEdit(p) : undefined}
        empty={reg.hasFilters ? <SearchEmpty q={reg.q} onClear={reg.clearFilters} /> : <EmptyState icon={<IconHelmet />} title={t("people.empty")} body={t("people.emptyHint")} action={canEdit ? <span className="btn-group"><Button size="sm" variant="primary" onClick={() => setEdit(blank())}>{t("people.add")}</Button><Button size="sm" onClick={() => setImporting(true)}>{t("csv.importCsv")}</Button></span> : undefined} />} />
      {reg.data ? <Pagination page={reg.data.page} pageSize={reg.data.pageSize} total={reg.data.total} onPage={reg.setPage} /> : null}
      {edit ? <PersonSheet p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reg.reload(); }} /> : null}
      {importing ? (
        <Sheet title={t("people.importTitle")} onClose={() => setImporting(false)} wide>
          <CsvImport columns={[{ key: "name", label: t("people.name"), required: true }, { key: "phone", label: t("users.phone"), validate: (v) => (v && !/^[+\d][\d\s-]{6,15}$/.test(v) ? t("users.phoneBad") : null) }, { key: "employer", label: t("common.employer"), validate: (v) => (v && !contractors.data.some((c) => c.name.toLowerCase() === v.toLowerCase()) ? t("csv.unknownEmployer") : null) }, { key: "trade", label: t("common.trade") }, { key: "worker_type", label: t("people.workerType"), options: WORKER_TYPES }, { key: "language", label: t("common.language"), options: ["en", "hi", "ta", "kn"] }, { key: "site_code", label: t("sites.code"), validate: (v) => (v && !sites.some((s) => s.code === v) ? t("csv.unknownSite") : null) }]}
            sample={"name,phone,employer,trade,worker_type,language,site_code\nMurugan S,9876543210,Sri Balaji Scaffolding Pvt Ltd,scaffolding,contractor,ta,TN1"} onImport={(csv) => api.post<ImportResult>("/admin/people/import", { csv })} onDone={() => { setImporting(false); reg.reload(); }} />
        </Sheet>
      ) : null}
    </div>
  );
}

function PersonSheet({ p, onClose, onSaved }: { p: Partial<PersonAdmin>; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { contractors, sites } = useScope();
  const [f, setF] = useState<Partial<PersonAdmin>>(p);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setF(p), [p]);
  const phoneBad = !!f.phone && !/^[+\d][\d\s-]{6,15}$/.test(f.phone);
  const valid = !!f.fullName?.trim() && !phoneBad;
  return (
    <Sheet title={p.id ? `${t("common.edit")} · ${p.fullName}` : t("people.add")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try { if (p.id) await api.put(`/admin/people/${p.id}`, f); else await api.post("/admin/people", f); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>{t("common.save")}</Button></>}>
      <div className="form-grid">
        <Field label={t("people.name")} required><Input value={f.fullName ?? ""} onChange={(e) => setF({ ...f, fullName: e.target.value })} maxLength={100} autoFocus /></Field>
        <Field label={t("users.phone")} hint={p.id ? t("people.phoneKept", { masked: p.phoneMasked ?? "" }) : t("people.phoneHint")} error={phoneBad ? t("users.phoneBad") : undefined}><Input value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" maxLength={20} /></Field>
        <Field label={t("common.employer")}><Select value={f.employerId ?? ""} onChange={(e) => setF({ ...f, employerId: e.target.value || null })}><option value="">{t("common.ownCompany")}</option>{contractors.data.filter((c) => !c.isOwnCompany).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label={t("common.trade")}><Input value={f.trade ?? ""} onChange={(e) => setF({ ...f, trade: e.target.value })} maxLength={60} list="trades-list" /></Field>
        <Field label={t("people.workerType")}><Select value={f.workerType} onChange={(e) => setF({ ...f, workerType: e.target.value as ReporterType })}>{WORKER_TYPES.map((w) => <option key={w} value={w}>{t(`obs.reporterType.${w}`)}</option>)}</Select></Field>
        <Field label={t("common.language")}><Select value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value as Lang })}>{langOptions.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Select></Field>
      </div>
      <datalist id="trades-list">{["civil", "steel_fixing", "shuttering", "scaffolding", "electrical", "welding", "painting", "plumbing", "rigging", "operators", "housekeeping", "security"].map((x) => <option key={x} value={x} />)}</datalist>
      <Field label={t("contractors.sites")}><div className="chips-select">{sites.map((s) => <button key={s.id} type="button" className="chip" aria-pressed={(f.siteIds ?? []).includes(s.id)} onClick={() => setF({ ...f, siteIds: (f.siteIds ?? []).includes(s.id) ? (f.siteIds ?? []).filter((x) => x !== s.id) : [...(f.siteIds ?? []), s.id] })}>{s.code} · {pick(s.name)}</button>)}</div></Field>
      {p.id ? <Toggle label={t("sites.active")} checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} /> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
