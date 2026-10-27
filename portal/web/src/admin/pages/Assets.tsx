/* Equipment register: class, tag, SWL, owner employer, status (in service / do not use / retired), next examination due. Create/edit, CSV import, soft delete. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { Asset, AssetClass, ImportResult } from "../../shared/types";
import { Button, DataTable, EmptyState, ErrorCard, Field, Input, Pill, SearchEmpty, Select, Sheet, Textarea, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDate } from "../../shared/format";
import { IconPlus, IconTool, IconTrash, IconEdit } from "../../shared/icons";
import { api, asList, dateInputValue, errMessage, localCsv } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { CsvImport, ExportButton, FilterSelect, PageHead, useSiteAreas } from "../components";

const CLASSES: AssetClass[] = ["lifting_appliance", "lifting_gear", "pressure_plant", "boiler", "extinguisher", "first_aid_box", "ladder", "scaffold", "harness", "earth_pit", "insulating_mat", "rcd", "earth_moving", "vehicle", "machine", "other"];
const STATUSES: Asset["status"][] = ["in_service", "do_not_use", "retired"];

export default function Assets() {
  const { t } = useI18n();
  const { siteId, siteName, sites } = useScope();
  return (
    <>
      <PageHead title={t("nav.equipment")} sub={siteId ? siteName(siteId) : t("assets.pickSite")} />
      {siteId ? <AssetsRegister siteId={siteId} /> : <EmptyState icon={<IconTool />} title={t("assets.pickSite")} body={sites.length ? t("assets.pickSiteHint") : t("sites.emptyHint")} />}
    </>
  );
}

export function AssetsRegister({ siteId }: { siteId: string }) {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { employerName } = useScope();
  const { areas } = useSiteAreas(siteId);
  const state = useLoad(() => api.get("/admin/assets", { siteId }).then((r) => asList<Asset>(r)), [siteId]);
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<Partial<Asset> | null>(null);
  const [importing, setImporting] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canEdit = perms.canSiteConfig(siteId) && !perms.readOnly;
  const rows = (state.data ?? []).filter((a) => !hidden.has(a.id) && (!cls || a.assetClass === cls) && (!status || a.status === status) && (!q || `${a.tagNo} ${a.serialNo} ${a.makeModel}`.toLowerCase().includes(q.toLowerCase())));
  const due = (a: Asset) => a.nextExamDue ? (new Date(a.nextExamDue).getTime() < Date.now() ? "red" : new Date(a.nextExamDue).getTime() - Date.now() < 30 * 86_400_000 ? "amber" : "green") : "grey";
  const remove = (a: Asset) => {
    setHidden((h) => new Set(h).add(a.id));
    toast.undoable(t("assets.removed", { tag: a.tagNo }), async () => { try { await api.del(`/admin/assets/${a.id}`); state.reload(); } catch (e) { toast.error(errMessage(e)); } setHidden((h) => { const n = new Set(h); n.delete(a.id); return n; }); }, () => setHidden((h) => { const n = new Set(h); n.delete(a.id); return n; }));
  };
  const columns: Column<Asset>[] = [
    { key: "tagNo", label: t("assets.tag"), render: (a) => <div><div className="cell-title mono-sm">{a.tagNo}</div><div className="cell-sub">{a.makeModel}{a.serialNo ? ` · ${a.serialNo}` : ""}</div></div> },
    { key: "assetClass", label: t("assets.class"), render: (a) => t(`asset.${a.assetClass}`), width: 150 },
    { key: "area", label: t("common.area"), render: (a) => pick(areas.find((x) => x.id === a.areaId)?.name) || "—", width: 140 },
    { key: "swl", label: t("assets.swl"), render: (a) => a.swlKg ? `${a.swlKg} kg` : "—", num: true, width: 90 },
    { key: "owner", label: t("common.employer"), render: (a) => a.ownerEmployerId ? employerName(a.ownerEmployerId) || "—" : t("common.ownCompany"), width: 150 },
    { key: "status", label: t("common.status"), render: (a) => <Pill tone={a.status === "in_service" ? "green" : a.status === "do_not_use" ? "red" : "grey"}>{t(`assets.status.${a.status}`)}</Pill>, width: 120 },
    { key: "nextExamDue", label: t("assets.nextExam"), render: (a) => <Pill tone={due(a)}>{a.nextExamDue ? fmtDate(a.nextExamDue, lang) : t("assets.noExam")}</Pill>, width: 130 },
    { key: "tools", label: "", render: (a) => canEdit ? <span className="row-actions"><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); setEdit(a); }} aria-label={t("common.edit")}><IconEdit size={14} /></Button><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); remove(a); }} aria-label={t("common.remove")}><IconTrash size={14} /></Button></span> : null, width: 80 },
  ];
  return (
    <div className="stack">
      <div className="filters">
        <div className="field grow-search"><label>{t("common.search")}</label><Input data-register-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("assets.searchPh")} /></div>
        <FilterSelect label={t("assets.class")} value={cls} onChange={setCls} options={CLASSES.map((c) => ({ value: c, label: t(`asset.${c}`) }))} />
        <FilterSelect label={t("common.status")} value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`assets.status.${s}`) }))} />
        <div className="end">
          <ExportButton onExport={async () => localCsv(rows.map((a) => ({ tag: a.tagNo, class: a.assetClass, make_model: a.makeModel, serial: a.serialNo, swl_kg: a.swlKg ?? "", status: a.status, next_exam_due: a.nextExamDue ?? "", area: pick(areas.find((x) => x.id === a.areaId)?.name) })), "equipment.csv")} />
          {canEdit ? <><Button size="sm" onClick={() => setImporting(true)}>{t("csv.importCsv")}</Button><Button size="sm" variant="primary" onClick={() => setEdit({ siteId, areaId: null, assetClass: "lifting_gear", tagNo: "", serialNo: "", makeModel: "", swlKg: null, ownerEmployerId: null, status: "in_service", statusReason: "", nextExamDue: null })}><IconPlus size={14} />{t("assets.add")}</Button></> : null}
        </div>
      </div>
      {state.error && !state.data ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} loading={state.loading && !state.data} onRow={canEdit ? (a) => setEdit(a) : undefined}
        empty={q || cls || status ? <SearchEmpty q={q} onClear={() => { setQ(""); setCls(""); setStatus(""); }} /> : <EmptyState icon={<IconTool />} title={t("assets.empty")} body={t("assets.emptyHint")} action={canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit({ siteId, areaId: null, assetClass: "lifting_gear", tagNo: "", serialNo: "", makeModel: "", swlKg: null, ownerEmployerId: null, status: "in_service", statusReason: "", nextExamDue: null })}>{t("assets.add")}</Button> : undefined} />} />
      {edit ? <AssetSheet asset={edit} siteId={siteId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} /> : null}
      {importing ? (
        <Sheet title={t("assets.importTitle")} onClose={() => setImporting(false)} wide>
          <CsvImport columns={[{ key: "tag_no", label: t("assets.tag"), required: true }, { key: "asset_class", label: t("assets.class"), required: true, options: CLASSES }, { key: "make_model", label: t("assets.makeModel") }, { key: "serial_no", label: t("assets.serial") }, { key: "swl_kg", label: t("assets.swl"), validate: (v) => (v && Number.isNaN(Number(v)) ? t("csv.number") : null) }, { key: "area_code", label: t("common.area") }, { key: "next_exam_due", label: t("assets.nextExam"), validate: (v) => (v && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? t("csv.date") : null) }]}
            sample={"tag_no,asset_class,make_model,serial_no,swl_kg,area_code,next_exam_due\nCR-01,lifting_appliance,ACE 14XW,SN1234,14000,YARD,2027-03-31"} onImport={(csv) => api.post<ImportResult>("/admin/assets/import", { siteId, csv })} onDone={() => { setImporting(false); state.reload(); }} />
        </Sheet>
      ) : null}
    </div>
  );
}

function AssetSheet({ asset, siteId, onClose, onSaved }: { asset: Partial<Asset>; siteId: string; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { contractors } = useScope();
  const { areas } = useSiteAreas(siteId);
  const [f, setF] = useState<Partial<Asset>>(asset);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setF(asset), [asset]);
  const valid = !!f.tagNo?.trim() && (f.status === "in_service" || !!f.statusReason?.trim());
  return (
    <Sheet title={asset.id ? `${t("assets.edit")} · ${asset.tagNo}` : t("assets.add")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try { if (asset.id) await api.put(`/admin/assets/${asset.id}`, { ...f, siteId }); else await api.post("/admin/assets", { ...f, siteId }); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>{t("common.save")}</Button></>}>
      <div className="form-grid">
        <Field label={t("assets.tag")} required><Input value={f.tagNo ?? ""} onChange={(e) => setF({ ...f, tagNo: e.target.value })} maxLength={40} autoFocus /></Field>
        <Field label={t("assets.class")} required><Select value={f.assetClass} onChange={(e) => setF({ ...f, assetClass: e.target.value as AssetClass })}>{CLASSES.map((c) => <option key={c} value={c}>{t(`asset.${c}`)}</option>)}</Select></Field>
        <Field label={t("assets.makeModel")}><Input value={f.makeModel ?? ""} onChange={(e) => setF({ ...f, makeModel: e.target.value })} maxLength={80} /></Field>
        <Field label={t("assets.serial")}><Input value={f.serialNo ?? ""} onChange={(e) => setF({ ...f, serialNo: e.target.value })} maxLength={80} /></Field>
        <Field label={t("assets.swl")} hint={t("assets.swlHint")}><Input type="number" min={0} value={f.swlKg ?? ""} onChange={(e) => setF({ ...f, swlKg: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        <Field label={t("common.area")}><Select value={f.areaId ?? ""} onChange={(e) => setF({ ...f, areaId: e.target.value || null })}><option value="">—</option>{areas.map((a) => <option key={a.id} value={a.id}>{pick(a.name)}</option>)}</Select></Field>
        <Field label={t("assets.ownerEmployer")}><Select value={f.ownerEmployerId ?? ""} onChange={(e) => setF({ ...f, ownerEmployerId: e.target.value || null })}><option value="">{t("common.ownCompany")}</option>{contractors.data.filter((c) => !c.isOwnCompany).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label={t("assets.nextExam")} hint={t("assets.nextExamHint")}><Input type="date" value={dateInputValue(f.nextExamDue)} onChange={(e) => setF({ ...f, nextExamDue: e.target.value || null })} /></Field>
        <Field label={t("common.status")}><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Asset["status"] })}>{STATUSES.map((s) => <option key={s} value={s}>{t(`assets.status.${s}`)}</option>)}</Select></Field>
        {f.status !== "in_service" ? <div className="full"><Field label={t("assets.statusReason")} required><Textarea rows={2} value={f.statusReason ?? ""} onChange={(e) => setF({ ...f, statusReason: e.target.value })} maxLength={300} /></Field></div> : null}
      </div>
      {f.status === "do_not_use" ? <div className="banner critical">{t("assets.doNotUseNote")}</div> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
