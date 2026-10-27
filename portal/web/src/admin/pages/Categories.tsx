/* Observation categories: drag-reorder list, edit sheet with 4-language names, kit icon, applies-to, critical flag, incident prompt,
   IS 3786 default, extra-fields builder, recipient roles and email detail. */
import { useEffect, useState, type ComponentType, type DragEvent } from "react";
import { useI18n } from "../../shared/i18n";
import type { Category, ExtraField, I18n, ObservationType, Role } from "../../shared/types";
import { Button, Chip, ChipBar, EmptyState, ErrorCard, Field, Input, Pill, Select, Sheet, Skeleton, Textarea, Toggle, useToast } from "../../shared/ui";
import * as Icons from "../../shared/icons";
import { IconEdit, IconMenu, IconPlus, IconTrash } from "../../shared/icons";
import { api, errMessage, localCsv } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { ChipsSelect, ExportButton, I18nInput, PageHead } from "../components";

const ICON_NAMES = Object.keys(Icons).filter((k) => k.startsWith("Icon")).map((k) => k.slice(4));
const TYPES: ObservationType[] = ["good_practice", "unsafe_act", "unsafe_condition", "near_miss"];
const ROLES: Role[] = ["site_safety_officer", "site_head", "hse_manager", "action_owner", "verifier"];

function KitIcon({ name, size = 20 }: { name: string; size?: number }) {
  const C = (Icons as unknown as Record<string, ComponentType<{ size?: number }>>)[`Icon${name}`];
  return C ? <C size={size} /> : <Icons.IconLayers size={size} />;
}

export default function Categories() {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { categories, reload, industries, loadIndustries } = useScope();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<Category[]>([]);
  useEffect(() => { setOrder([...categories.data].sort((a, b) => a.sort - b.sort)); }, [categories.data]);
  useEffect(() => { loadIndustries().catch(() => undefined); }, [loadIndustries]);
  const canEdit = perms.isHse && !perms.readOnly;
  const rows = order.filter((c) => !hidden.has(c.id));
  const onDrop = async (e: DragEvent, target: Category) => {
    e.preventDefault(); setOverId(null);
    const src = rows.find((c) => c.id === dragId); setDragId(null);
    if (!src || src.id === target.id) return;
    const next = rows.filter((c) => c.id !== src.id);
    next.splice(next.findIndex((c) => c.id === target.id), 0, src);
    setOrder(next);
    try { await api.post("/admin/categories/reorder", { ids: next.map((c) => c.id) }); toast.success(t("cats.reordered")); await reload("categories"); } catch (er) { toast.error(errMessage(er)); setOrder([...categories.data].sort((a, b) => a.sort - b.sort)); }
  };
  const remove = (c: Category) => {
    setHidden((h) => new Set(h).add(c.id));
    toast.undoable(t("cats.removed", { name: pick(c.name) }), async () => { try { await api.del(`/admin/categories/${c.id}`); await reload("categories"); } catch (e) { toast.error(errMessage(e)); } setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }); }, () => setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; }));
  };
  const blank = (): Partial<Category> => ({ code: "", parentCode: null, name: { en: "" }, icon: "Hazard", appliesTo: {}, criticalCapable: false, incidentPrompt: "", is3786Default: "B-2", extraFields: [], defaultRecipientRoles: ["site_safety_officer"], emailDetail: "summary", active: true });
  return (
    <>
      <PageHead title={t("nav.categories")} sub={t("cats.sub")} tools={<>
        <ExportButton onExport={async () => localCsv(rows.map((c) => ({ code: c.code, name_en: c.name.en, name_hi: c.name.hi ?? "", name_ta: c.name.ta ?? "", name_kn: c.name.kn ?? "", critical: c.criticalCapable, incident_prompt: c.incidentPrompt, is3786: c.is3786Default, recipients: c.defaultRecipientRoles.join("|"), email: c.emailDetail, active: c.active })), "categories.csv")} />
        {canEdit ? <Button variant="primary" onClick={() => setEdit(blank())}><IconPlus size={16} />{t("cats.add")}</Button> : null}
      </>} />
      {categories.error ? <ErrorCard error={categories.error} onRetry={() => reload("categories")} /> : null}
      {!categories.loaded ? <Skeleton lines={8} /> : null}
      {categories.loaded && rows.length === 0 ? <EmptyState title={t("cats.empty")} body={t("cats.emptyHint")} action={canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit(blank())}>{t("cats.add")}</Button> : undefined} /> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{canEdit ? <th style={{ width: 30 }} /> : null}<th>{t("cats.code")}</th><th>{t("cats.name")}</th><th>{t("cats.appliesTo")}</th><th>{t("cats.flags")}</th><th>{t("cats.recipients")}</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={overId === c.id ? "active" : undefined} draggable={canEdit} onDragStart={() => setDragId(c.id)} onDragOver={(e) => { e.preventDefault(); setOverId(c.id); }} onDragLeave={() => setOverId(null)} onDrop={(e) => onDrop(e, c)}>
                  {canEdit ? <td><span className="grip" style={{ cursor: "grab", color: "var(--muted)" }} aria-hidden><IconMenu size={16} /></span></td> : null}
                  <td><span className="row nowrap" style={{ gap: 6 }}><KitIcon name={c.icon} /><span className="case">{c.code}</span></span>{c.parentCode ? <div className="cell-sub">↳ {c.parentCode}</div> : null}</td>
                  <td><div className="cell-title">{pick(c.name)}</div><div className="cell-sub">{["hi", "ta", "kn"].map((l) => (c.name as Record<string, string>)[l]).filter(Boolean).join(" · ") || <span style={{ color: "var(--amber)" }}>{t("cats.noTranslations")}</span>}</div></td>
                  <td className="small">{(c.appliesTo.industries?.length ? c.appliesTo.industries.join(", ") : t("cats.allIndustries"))}<div className="cell-sub">{(c.appliesTo.types?.length ? c.appliesTo.types.map((x) => t(`type.${x}`)).join(", ") : t("cats.allTypes"))}</div></td>
                  <td><div className="row" style={{ gap: 4 }}>{c.criticalCapable ? <Pill tone="red">{t("cats.critical")}</Pill> : null}{c.incidentPrompt ? <Pill tone="orange" title={c.incidentPrompt}>{t("cats.incident")}</Pill> : null}<Pill>{c.is3786Default || "—"}</Pill>{c.extraFields.length ? <Pill tone="blue">{t("cats.extraN", { n: c.extraFields.length })}</Pill> : null}{!c.active ? <Pill tone="grey">{t("sites.inactive")}</Pill> : null}</div></td>
                  <td className="small">{c.defaultRecipientRoles.map((r) => t(`role.${r}`)).join(", ")}<div className="cell-sub">{t(`cats.email.${c.emailDetail}`)}</div></td>
                  <td>{canEdit ? <span className="row-actions"><Button size="sm" variant="ghost" icon onClick={() => setEdit(c)} aria-label={t("common.edit")}><IconEdit size={14} /></Button><Button size="sm" variant="ghost" icon onClick={() => remove(c)} aria-label={t("common.remove")}><IconTrash size={14} /></Button></span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {canEdit && rows.length ? <p className="small muted" style={{ marginTop: 8 }}>{t("areas.dragHint")}</p> : null}
      {edit ? <CategorySheet c={edit} all={categories.data} industries={industries.data.map((i) => ({ code: i.code, name: pick(i.name) }))} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload("categories"); }} /> : null}
    </>
  );
}

function CategorySheet({ c, all, industries, onClose, onSaved }: { c: Partial<Category>; all: Category[]; industries: { code: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const [f, setF] = useState<Partial<Category>>(c);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setF(c), [c]);
  const valid = !!f.code?.trim() && !!f.name?.en?.trim() && (f.extraFields ?? []).every((x) => x.key.trim() && x.label.en.trim());
  const setExtra = (i: number, patch: Partial<ExtraField>) => setF({ ...f, extraFields: (f.extraFields ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <Sheet title={c.id ? `${t("common.edit")} · ${pick(c.name)}` : t("cats.add")} onClose={onClose} wide footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try { if (c.id) await api.put(`/admin/categories/${c.id}`, f); else await api.post("/admin/categories", f); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>{t("common.save")}</Button></>}>
      <I18nInput label={t("cats.name")} required value={f.name} onChange={(v: I18n) => setF({ ...f, name: v })} />
      <div className="form-grid">
        <Field label={t("cats.code")} required><Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} maxLength={16} disabled={!!c.id} /></Field>
        <Field label={t("cats.parent")}><Select value={f.parentCode ?? ""} onChange={(e) => setF({ ...f, parentCode: e.target.value || null })}><option value="">—</option>{all.filter((x) => x.code !== c.code && !x.parentCode).map((x) => <option key={x.code} value={x.code}>{pick(x.name)}</option>)}</Select></Field>
        <Field label={t("cats.icon")} hint={<span className="row" style={{ gap: 6 }}><KitIcon name={f.icon ?? ""} size={18} />{t("cats.iconHint")}</span>}>
          <Select value={f.icon ?? ""} onChange={(e) => setF({ ...f, icon: e.target.value })}>{ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
        </Field>
        <Field label={t("triage.is3786")} hint={t("cats.is3786Hint")}><Select value={f.is3786Default ?? ""} onChange={(e) => setF({ ...f, is3786Default: e.target.value })}><option value="">—</option><option value="B-2">B-2 · {t("triage.is3786.B2")}</option><option value="B-3">B-3 · {t("triage.is3786.B3")}</option><option value="B-4">B-4 · {t("triage.is3786.B4")}</option></Select></Field>
      </div>
      <Field label={t("cats.appliesIndustries")} hint={t("cats.appliesHint")}><ChipsSelect ariaLabel={t("cats.appliesIndustries")} options={industries.map((i) => ({ value: i.code, label: i.name }))} value={f.appliesTo?.industries ?? []} onChange={(v) => setF({ ...f, appliesTo: { ...f.appliesTo, industries: v } })} /></Field>
      <Field label={t("cats.appliesTypes")}><ChipsSelect ariaLabel={t("cats.appliesTypes")} options={TYPES.map((x) => ({ value: x, label: t(`type.${x}`) }))} value={f.appliesTo?.types ?? []} onChange={(v) => setF({ ...f, appliesTo: { ...f.appliesTo, types: v } })} /></Field>
      <Toggle label={t("cats.critical")} hint={t("cats.criticalHint")} checked={!!f.criticalCapable} onChange={(v) => setF({ ...f, criticalCapable: v })} danger />
      <Field label={t("cats.incidentPrompt")} optional hint={t("cats.incidentPromptHint")}><Input value={f.incidentPrompt ?? ""} onChange={(e) => setF({ ...f, incidentPrompt: e.target.value })} maxLength={80} /></Field>
      <div className="form-grid">
        <Field label={t("cats.recipients")} hint={t("cats.recipientsHint")}><ChipsSelect ariaLabel={t("cats.recipients")} options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} value={f.defaultRecipientRoles ?? []} onChange={(v) => setF({ ...f, defaultRecipientRoles: v })} /></Field>
        <Field label={t("cats.emailDetail")} hint={t("cats.emailDetailHint")}><Select value={f.emailDetail ?? "summary"} onChange={(e) => setF({ ...f, emailDetail: e.target.value as Category["emailDetail"] })}><option value="private">{t("cats.email.private")}</option><option value="summary">{t("cats.email.summary")}</option><option value="detailed">{t("cats.email.detailed")}</option></Select></Field>
      </div>
      <div className="section-title">{t("cats.extraFields")}</div>
      <p className="small muted">{t("cats.extraFieldsHint")}</p>
      {(f.extraFields ?? []).map((x, i) => (
        <div className="action-draft" key={i}>
          <div className="row between" style={{ marginBottom: 6 }}><strong>{x.label.en || t("cats.field")} #{i + 1}</strong><Button size="sm" variant="ghost" icon onClick={() => setF({ ...f, extraFields: (f.extraFields ?? []).filter((_, j) => j !== i) })} aria-label={t("common.remove")}><IconTrash size={14} /></Button></div>
          <div className="form-grid">
            <Field label={t("cats.fieldKey")} required><Input value={x.key} onChange={(e) => setExtra(i, { key: e.target.value.replace(/[^a-z0-9_]/g, "") })} maxLength={30} /></Field>
            <Field label={t("cats.fieldType")}><Select value={x.type} onChange={(e) => setExtra(i, { type: e.target.value as ExtraField["type"] })}><option value="text">{t("cats.fieldType.text")}</option><option value="number">{t("cats.fieldType.number")}</option><option value="choice">{t("cats.fieldType.choice")}</option><option value="boolean">{t("cats.fieldType.boolean")}</option></Select></Field>
          </div>
          <I18nInput label={t("cats.fieldLabel")} required value={x.label} onChange={(v) => setExtra(i, { label: v })} />
          {x.type === "choice" ? (
            <Field label={t("cats.fieldOptions")} hint={t("cats.fieldOptionsHint")}>
              <Textarea rows={2} value={(x.options ?? []).map((o) => o.en).join("\n")} onChange={(e) => setExtra(i, { options: e.target.value.split("\n").filter(Boolean).map((s) => ({ ...(x.options ?? []).find((o) => o.en === s), en: s })) })} />
            </Field>
          ) : null}
          <Toggle label={t("common.required")} checked={!!x.required} onChange={(v) => setExtra(i, { required: v })} />
        </div>
      ))}
      <Button size="sm" onClick={() => setF({ ...f, extraFields: [...(f.extraFields ?? []), { key: "", label: { en: "" }, type: "text", required: false }] })}><IconPlus size={14} />{t("cats.addField")}</Button>
      {c.id ? <Toggle label={t("sites.active")} checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} /> : null}
      <ChipBar wrap><Chip disabled>{t("cats.previewChip")}: <KitIcon name={f.icon ?? ""} size={16} /> {f.name?.en || "—"}</Chip></ChipBar>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
