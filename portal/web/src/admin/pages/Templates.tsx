/* Inspection templates: list, detail with versions, builder for drafts (sections, questions, answer types, response sets, number ranges,
   fail logic, action defaults, show_if, reference + status) with a live phone-frame preview, submit / approve / retire / copy; Schedules tab. */
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { AnswerType, AreaType, AssetClass, Band, ControlLevel, I18n, Question, ResponseOption, Role, Schedule, Section, StatusLabel, TemplateVersion } from "../../shared/types";
import { Button, Card, CardHead, Chip, ChipBar, Confirm, DataTable, EmptyState, ErrorCard, Field, Input, Pill, SearchEmpty, Select, Sheet, Skeleton, Tabs, Textarea, Toggle, useToast, type Column } from "../../shared/ui";
import { useLoad, useBeforeUnload } from "../../shared/hooks";
import { fmtDate, fmtDateTime } from "../../shared/format";
import { IconCopy, IconEdit, IconMenu, IconPlus, IconTrash, IconClipboard, IconCheck, IconSend, IconCalendar } from "../../shared/icons";
import { uuid } from "../../shared/storage";
import { api, asList, errMessage, localCsv } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { ChipsSelect, ExportButton, I18nInput, KV, PageHead, StatusSelect, StatusTag, UserPicker, useSiteAreas } from "../components";

const ANSWER_TYPES: AnswerType[] = ["pass_fail_na", "number", "text", "photo", "signature", "date", "single_choice", "multi_choice"];
const ROLES: Role[] = ["action_owner", "site_safety_officer", "site_head", "hse_manager"];
const BANDS: Band[] = ["low", "moderate", "high", "extreme"];
const CONTROLS: ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];
const AREA_TYPES: AreaType[] = ["production", "utilities", "store", "yard", "scaffold_zone", "excavation_zone", "substation", "office", "canteen", "gate", "labour_camp", "loading_bay", "other"];
const ASSET_CLASSES: AssetClass[] = ["lifting_appliance", "lifting_gear", "pressure_plant", "boiler", "extinguisher", "first_aid_box", "ladder", "scaffold", "harness", "earth_pit", "insulating_mat", "rcd", "earth_moving", "vehicle", "machine", "other"];
const TEMPLATE_TYPES = ["site_walk", "scaffold", "excavation", "lifting", "electrical", "fire", "ppe", "housekeeping", "vehicle", "confined_space", "audit", "other"];
const STATUS_TONE: Record<TemplateVersion["status"], "green" | "amber" | "blue" | "grey"> = { draft: "amber", in_review: "blue", active: "green", retired: "grey" };

export const PASS_FAIL_NA: ResponseOption[] = [
  { value: "pass", label: { en: "Pass", hi: "पास", ta: "சரி", kn: "ಸರಿ" }, colour: "green", flag: false, score: 1 },
  { value: "fail", label: { en: "Fail", hi: "फेल", ta: "தவறு", kn: "ವಿಫಲ" }, colour: "red", flag: true, score: 0 },
  { value: "na", label: { en: "N/A", hi: "लागू नहीं", ta: "பொருந்தாது", kn: "ಅನ್ವಯಿಸುವುದಿಲ್ಲ" }, colour: "grey", flag: false, score: null },
];
export function newQuestion(sort: number): Question {
  return { id: uuid(), code: `Q${sort + 1}`, sort, text: { en: "" }, guidance: { en: "" }, guidanceMediaUrl: null, answerType: "pass_fail_na", responseSet: PASS_FAIL_NA.map((o) => ({ ...o })), unit: "", min: null, max: null, passMin: null, passMax: null, required: true, photoOnFail: true, noteOnFail: true, actionOnFail: true, actionDefaults: { ownerRole: "site_safety_officer", band: "moderate", dueOffsetHours: 720, controlLevel: "administrative" }, showIf: null, referenceText: "", referenceStatus: "company_standard" };
}
function newSection(sort: number): Section { return { id: uuid(), sort, title: { en: "" }, repeatable: false, repeatLabel: "", questions: [newQuestion(0)] }; }

export default function Templates({ tab: initial = "templates" }: { tab?: "templates" | "schedules" }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { id } = useParams();
  if (id) return <TemplateDetail id={id} />;
  return (
    <>
      <PageHead title={t("nav.templates")} sub={t("templates.sub")} />
      <Tabs value={initial} onChange={(v) => nav(v === "templates" ? "/templates" : "/schedules")} tabs={[{ value: "templates", label: t("nav.templates") }, { value: "schedules", label: t("nav.schedules") }]} />
      <div style={{ marginTop: 14 }}>{initial === "templates" ? <TemplateList /> : <SchedulesTab />}</div>
    </>
  );
}

/* ------------------------------------------------------------------ list */
function TemplateList() {
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { perms } = useAuth();
  const state = useLoad(() => api.get("/admin/inspections/templates").then((r) => asList<TemplateVersion>(r)), []);
  const [q, setQ] = useState("");
  const [create, setCreate] = useState(false);
  const [copy, setCopy] = useState<TemplateVersion | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canCreate = (perms.isHse || perms.canTriage) && !perms.readOnly;
  const rows = (state.data ?? []).filter((v) => !hidden.has(v.templateId) && (!q || `${v.code} ${pick(v.name)} ${v.type}`.toLowerCase().includes(q.toLowerCase())));
  const remove = (v: TemplateVersion) => {
    setHidden((h) => new Set(h).add(v.templateId));
    toast.undoable(t("templates.archived", { name: pick(v.name) }), async () => { try { await api.del(`/admin/inspections/templates/${v.templateId}`); state.reload(); } catch (e) { toast.error(errMessage(e)); } setHidden((h) => { const n = new Set(h); n.delete(v.templateId); return n; }); }, () => setHidden((h) => { const n = new Set(h); n.delete(v.templateId); return n; }));
  };
  const columns: Column<TemplateVersion>[] = [
    { key: "code", label: t("templates.code"), render: (v) => <span className="case">{v.code}</span>, width: 110 },
    { key: "name", label: t("templates.name"), render: (v) => <div><div className="cell-title">{pick(v.name)}</div><div className="cell-sub">{t(`templates.type.${v.type}`) === `templates.type.${v.type}` ? v.type : t(`templates.type.${v.type}`)} · {v.sections.reduce((a, s) => a + s.questions.length, 0)} {t("templates.questions")}</div></div> },
    { key: "version", label: t("templates.version"), render: (v) => <span className="row nowrap" style={{ gap: 4 }}>v{v.version}<Pill tone={STATUS_TONE[v.status]}>{t(`templates.status.${v.status}`)}</Pill></span>, width: 150 },
    { key: "applies", label: t("templates.appliesTo"), render: (v) => <span className="small">{[v.appliesTo.industries?.join(", "), v.appliesTo.areaTypes?.map((a) => t(`area.${a}`)).join(", "), v.appliesTo.assetClasses?.map((a) => t(`asset.${a}`)).join(", ")].filter(Boolean).join(" · ") || t("templates.appliesAll")}</span> },
    { key: "who", label: t("templates.author"), render: (v) => <span className="small">{v.authorName ?? "—"}{v.approvedByName ? ` → ${v.approvedByName}` : ""}<div className="cell-sub">{fmtDate(v.updatedAt, lang)}</div></span>, width: 170 },
    { key: "tools", label: "", render: (v) => canCreate ? <span className="row-actions"><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCopy(v); }} title={t("templates.copy")}><IconCopy size={14} /></Button>{perms.isHse ? <Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); remove(v); }} aria-label={t("templates.archive")}><IconTrash size={14} /></Button> : null}</span> : null, width: 90 },
  ];
  return (
    <div className="stack">
      <div className="filters">
        <div className="field grow-search"><label>{t("common.search")}</label><Input data-register-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("templates.searchPh")} /></div>
        <div className="end">
          <ExportButton onExport={async () => localCsv(rows.map((v) => ({ code: v.code, name: v.name.en, type: v.type, version: v.version, status: v.status, questions: v.sections.reduce((a, s) => a + s.questions.length, 0), author: v.authorName ?? "", approved_by: v.approvedByName ?? "" })), "templates.csv")} />
          {canCreate ? <Button variant="primary" size="sm" onClick={() => setCreate(true)}><IconPlus size={14} />{t("templates.new")}</Button> : null}
        </div>
      </div>
      {state.error && !state.data ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(v) => v.templateId} loading={state.loading && !state.data} onRow={(v) => nav(`/templates/${v.templateId}`)}
        empty={q ? <SearchEmpty q={q} onClear={() => setQ("")} /> : <EmptyState icon={<IconClipboard />} title={t("templates.empty")} body={t("templates.emptyHint")} action={canCreate ? <Button size="sm" variant="primary" onClick={() => setCreate(true)}>{t("templates.new")}</Button> : undefined} />} />
      {create ? <NewTemplateSheet onClose={() => setCreate(false)} onCreated={(v) => nav(`/templates/${v.templateId}`)} /> : null}
      {copy ? <NewTemplateSheet from={copy} onClose={() => setCopy(null)} onCreated={(v) => nav(`/templates/${v.templateId}`)} /> : null}
    </div>
  );
}

function NewTemplateSheet({ from, onClose, onCreated }: { from?: TemplateVersion; onClose: () => void; onCreated: (v: TemplateVersion) => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const [code, setCode] = useState(from ? `${from.code}-COPY` : "");
  const [name, setName] = useState<I18n>(from ? { ...from.name, en: `${from.name.en} (copy)` } : { en: "" });
  const [type, setType] = useState(from?.type ?? "site_walk");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid = /^[A-Z0-9-]{2,16}$/.test(code) && !!name.en.trim();
  return (
    <Sheet title={from ? t("templates.copyTitle", { name: pick(from.name) }) : t("templates.new")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try {
        const r = from ? await api.post(`/admin/inspections/templates/${from.templateId}/copy`, { code, name }) : await api.post("/admin/inspections/templates", { code, name, type });
        const v = (Array.isArray(r) ? r[0] : r) as TemplateVersion;
        toast.success(t("templates.created")); onCreated(v);
      } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>{from ? t("templates.copy") : t("templates.create")}</Button></>}>
      {from ? <p className="small muted">{t("templates.copyBody")}</p> : <p className="small muted">{t("templates.newBody")}</p>}
      <Field label={t("templates.code")} required hint={t("templates.codeRule")}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={16} autoFocus /></Field>
      <I18nInput label={t("templates.name")} required value={name} onChange={setName} />
      {!from ? <Field label={t("templates.typeLabel")}><Select value={type} onChange={(e) => setType(e.target.value)}>{TEMPLATE_TYPES.map((x) => <option key={x} value={x}>{t(`templates.type.${x}`)}</option>)}</Select></Field> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ detail + builder */
function TemplateDetail({ id }: { id: string }) {
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { perms, me } = useAuth();
  const state = useLoad(() => api.get(`/admin/inspections/templates/${id}`).then((r) => { const l = asList<TemplateVersion>(r); return l.length ? l : [r as TemplateVersion]; }), [id]);
  const versions = useMemo(() => [...(state.data ?? [])].sort((a, b) => b.version - a.version), [state.data]);
  const [sel, setSel] = useState<string>("");
  const [approveErr, setApproveErr] = useState("");
  const [confirmRetire, setConfirmRetire] = useState<TemplateVersion | null>(null);
  const [copy, setCopy] = useState<TemplateVersion | null>(null);
  const cur = versions.find((v) => v.id === sel) ?? versions.find((v) => v.status === "draft") ?? versions[0] ?? null;
  const canEdit = (perms.isHse || perms.canTriage) && !perms.readOnly;
  const canApprove = perms.isHse && !perms.readOnly;
  const replace = (v: TemplateVersion) => state.setData((state.data ?? []).map((x) => (x.id === v.id ? v : x)).concat((state.data ?? []).some((x) => x.id === v.id) ? [] : [v]));
  const transition = async (v: TemplateVersion, what: "submit" | "approve" | "retire") => {
    setApproveErr("");
    try { const nv = await api.post<TemplateVersion>(`/admin/inspections/template-versions/${v.id}/${what}`); state.reload(); toast.success(t(`templates.${what}Done`)); setSel(nv?.id ?? v.id); } catch (e) { setApproveErr(errMessage(e)); }
  };
  const newVersion = async () => { try { const nv = await api.post<TemplateVersion>(`/admin/inspections/templates/${id}/versions`); state.reload(); setSel(nv.id); toast.success(t("templates.draftCreated", { v: nv.version })); } catch (e) { toast.error(errMessage(e)); } };
  if (state.error && !state.data) return <ErrorCard error={state.error} onRetry={state.reload} />;
  if (!cur) return <Skeleton lines={8} />;
  const isAuthor = cur.authorName && me?.name === cur.authorName;
  return (
    <>
      <PageHead title={pick(cur.name)} sub={`${cur.code} · ${t(`templates.type.${cur.type}`) === `templates.type.${cur.type}` ? cur.type : t(`templates.type.${cur.type}`)}`} tools={<>
        <Link className="btn sm" to="/templates">{t("templates.all")}</Link>
        {canEdit ? <Button size="sm" onClick={() => setCopy(cur)}><IconCopy size={14} />{t("templates.copy")}</Button> : null}
        {canEdit && !versions.some((v) => v.status === "draft" || v.status === "in_review") ? <Button size="sm" variant="primary" onClick={newVersion}><IconPlus size={14} />{t("templates.newVersion")}</Button> : null}
      </>} />
      <Tabs value={cur.id} onChange={setSel} tabs={versions.map((v) => ({ value: v.id, label: <span className="row nowrap" style={{ gap: 6 }}>v{v.version}<Pill tone={STATUS_TONE[v.status]}>{t(`templates.status.${v.status}`)}</Pill></span> }))} />
      <div className="row between" style={{ margin: "12px 0" }}>
        <span className="small muted">{t("templates.versionMeta", { author: cur.authorName ?? "—", at: fmtDateTime(cur.updatedAt, lang) })}{cur.approvedByName ? ` · ${t("templates.approvedBy", { name: cur.approvedByName, at: fmtDate(cur.approvedAt, lang) })}` : ""}{cur.changeNote ? ` · ${cur.changeNote}` : ""}</span>
        <span className="btn-group">
          {canEdit && cur.status === "draft" ? <Button size="sm" variant="primary" onClick={() => transition(cur, "submit")}><IconSend size={14} />{t("templates.submit")}</Button> : null}
          {canApprove && cur.status === "in_review" ? <Button size="sm" variant="primary" onClick={() => transition(cur, "approve")} title={isAuthor ? t("templates.authorCannotApprove") : undefined}><IconCheck size={14} />{t("templates.approve")}</Button> : null}
          {canApprove && cur.status === "active" ? <Button size="sm" variant="danger" onClick={() => setConfirmRetire(cur)}>{t("templates.retire")}</Button> : null}
        </span>
      </div>
      {cur.status === "in_review" ? <div className="banner info" style={{ marginBottom: 12 }}>{t("templates.inReviewNote")}</div> : null}
      {approveErr ? <div className="error-card" role="alert" style={{ marginBottom: 12 }}><p style={{ margin: 0 }}>{approveErr}</p></div> : null}
      <Builder key={cur.id} v={cur} editable={canEdit && cur.status === "draft"} onSaved={replace} />
      {confirmRetire ? <Confirm danger title={t("templates.retireTitle", { v: confirmRetire.version })} body={t("templates.retireBody")} confirmLabel={t("templates.retire")} onClose={() => setConfirmRetire(null)} onConfirm={async () => { await transition(confirmRetire, "retire"); setConfirmRetire(null); }} /> : null}
      {copy ? <NewTemplateSheet from={copy} onClose={() => setCopy(null)} onCreated={(v) => nav(`/templates/${v.templateId}`)} /> : null}
    </>
  );
}

function Builder({ v, editable, onSaved }: { v: TemplateVersion; editable: boolean; onSaved: (v: TemplateVersion) => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { industries, loadIndustries } = useScope();
  const [doc, setDoc] = useState<TemplateVersion>(v);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [selQ, setSelQ] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ sec: string; q: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => { loadIndustries().catch(() => undefined); }, [loadIndustries]);
  useBeforeUnload(dirty);
  const update = (fn: (d: TemplateVersion) => TemplateVersion) => { setDoc((d) => fn(d)); setDirty(true); };
  const updateSec = (sid: string, fn: (s: Section) => Section) => update((d) => ({ ...d, sections: d.sections.map((s) => (s.id === sid ? fn(s) : s)) }));
  const updateQ = (sid: string, qid: string, fn: (q: Question) => Question) => updateSec(sid, (s) => ({ ...s, questions: s.questions.map((q) => (q.id === qid ? fn(q) : q)) }));
  const allCodes = doc.sections.flatMap((s) => s.questions.map((q) => q.code));
  const problems: string[] = [];
  if (doc.sections.length === 0) problems.push(t("builder.err.noSections"));
  doc.sections.forEach((s, i) => {
    if (!s.title.en.trim()) problems.push(t("builder.err.sectionTitle", { n: i + 1 }));
    s.questions.forEach((q) => {
      if (!q.text.en.trim()) problems.push(t("builder.err.questionText", { code: q.code }));
      if ((q.answerType === "single_choice" || q.answerType === "multi_choice" || q.answerType === "pass_fail_na") && q.responseSet.length < 2) problems.push(t("builder.err.options", { code: q.code }));
      if (q.actionOnFail && !q.responseSet.some((o) => o.flag) && q.answerType !== "number") problems.push(t("builder.err.noFlag", { code: q.code }));
      if (q.showIf && !allCodes.includes(q.showIf.questionCode)) problems.push(t("builder.err.showIf", { code: q.code }));
    });
  });
  const dupCodes = allCodes.filter((c, i) => allCodes.indexOf(c) !== i);
  if (dupCodes.length) problems.push(t("builder.err.dupCodes", { codes: [...new Set(dupCodes)].join(", ") }));
  const save = async () => {
    setBusy(true); setErr("");
    try { const saved = await api.put<TemplateVersion>(`/admin/inspections/template-versions/${v.id}`, { ...doc, sections: doc.sections.map((s, i) => ({ ...s, sort: i, questions: s.questions.map((q, j) => ({ ...q, sort: j })) })) }); setDoc(saved ?? doc); setDirty(false); onSaved(saved ?? doc); toast.success(t("common.saved")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
  };
  const onDropQ = (e: DragEvent, sid: string, targetQ: string | null) => {
    e.preventDefault(); setOver(null);
    if (!drag) return;
    const src = doc.sections.find((s) => s.id === drag.sec)?.questions.find((q) => q.id === drag.q);
    if (!src) return;
    update((d) => {
      const without = d.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => q.id !== src.id) }));
      return { ...d, sections: without.map((s) => { if (s.id !== sid) return s; const qs = [...s.questions]; const idx = targetQ ? qs.findIndex((q) => q.id === targetQ) : qs.length; qs.splice(idx < 0 ? qs.length : idx, 0, src); return { ...s, questions: qs }; }) };
    });
    setDrag(null);
  };
  const totalQ = doc.sections.reduce((a, s) => a + s.questions.length, 0);
  return (
    <div className="builder">
      <div>
        <Card>
          <CardHead title={t("builder.settings")} kicker={`${totalQ} ${t("templates.questions")}`} />
          <I18nInput label={t("templates.name")} required value={doc.name} onChange={(val) => update((d) => ({ ...d, name: val }))} />
          <div className="form-grid">
            <Field label={t("builder.passMark")} hint={t("builder.passMarkHint")}><Input type="number" min={0} max={100} value={doc.scoring.passMarkPct} onChange={(e) => update((d) => ({ ...d, scoring: { ...d.scoring, passMarkPct: Number(e.target.value) } }))} disabled={!editable} /></Field>
            <Field label={t("builder.competence")} optional hint={t("builder.competenceHint")}><Input value={doc.requiredCompetenceType} onChange={(e) => update((d) => ({ ...d, requiredCompetenceType: e.target.value }))} disabled={!editable} /></Field>
            <Field label={t("builder.changeNote")} optional><Input value={doc.changeNote} onChange={(e) => update((d) => ({ ...d, changeNote: e.target.value }))} disabled={!editable} maxLength={200} /></Field>
            <Field label={t("builder.titleFields")} hint={t("builder.titleFieldsHint")}><Input value={doc.titleFields.join(", ")} onChange={(e) => update((d) => ({ ...d, titleFields: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))} disabled={!editable} /></Field>
          </div>
          <Toggle label={t("builder.anyFail")} hint={t("builder.anyFailHint")} checked={doc.scoring.anyFailRule} onChange={(val) => update((d) => ({ ...d, scoring: { ...d.scoring, anyFailRule: val } }))} disabled={!editable} />
          <Field label={t("templates.appliesTo")} hint={t("builder.appliesHint")}>
            <div className="stack" style={{ gap: 6 }}>
              <ChipsSelect ariaLabel={t("sites.industry")} options={industries.data.map((i) => ({ value: i.code, label: pick(i.name) }))} value={doc.appliesTo.industries ?? []} onChange={(val) => editable && update((d) => ({ ...d, appliesTo: { ...d.appliesTo, industries: val } }))} />
              <ChipsSelect ariaLabel={t("areas.type")} options={AREA_TYPES.map((a) => ({ value: a, label: t(`area.${a}`) }))} value={doc.appliesTo.areaTypes ?? []} onChange={(val) => editable && update((d) => ({ ...d, appliesTo: { ...d.appliesTo, areaTypes: val } }))} />
              <ChipsSelect ariaLabel={t("assets.class")} options={ASSET_CLASSES.map((a) => ({ value: a, label: t(`asset.${a}`) }))} value={doc.appliesTo.assetClasses ?? []} onChange={(val) => editable && update((d) => ({ ...d, appliesTo: { ...d.appliesTo, assetClasses: val } }))} />
            </div>
          </Field>
        </Card>
        <div className="section-title">{t("builder.sections")}</div>
        {doc.sections.map((s, si) => (
          <div className="sec" key={s.id}>
            <div className="sec-head">
              <span className="kicker">{si + 1}</span>
              <Input value={s.title.en} onChange={(e) => updateSec(s.id, (x) => ({ ...x, title: { ...x.title, en: e.target.value } }))} placeholder={t("builder.sectionTitle")} disabled={!editable} aria-label={t("builder.sectionTitle")} />
              {editable ? <>
                <Button size="sm" variant="ghost" onClick={() => update((d) => { const secs = [...d.sections]; if (si > 0) [secs[si - 1], secs[si]] = [secs[si], secs[si - 1]]; return { ...d, sections: secs }; })} disabled={si === 0} aria-label={t("builder.moveUp")}>↑</Button>
                <Button size="sm" variant="ghost" onClick={() => update((d) => { const secs = [...d.sections]; if (si < secs.length - 1) [secs[si + 1], secs[si]] = [secs[si], secs[si + 1]]; return { ...d, sections: secs }; })} disabled={si === doc.sections.length - 1} aria-label={t("builder.moveDown")}>↓</Button>
                <Button size="sm" variant="ghost" icon onClick={() => update((d) => ({ ...d, sections: d.sections.filter((x) => x.id !== s.id) }))} aria-label={t("common.remove")}><IconTrash size={14} /></Button>
              </> : null}
            </div>
            <div className="sec-body">
              {editable ? (
                <div className="row" style={{ marginBottom: 8 }}>
                  <I18nInput label={t("builder.sectionTitleLangs")} value={s.title} onChange={(val) => updateSec(s.id, (x) => ({ ...x, title: val }))} />
                </div>
              ) : null}
              <div className="row" style={{ marginBottom: 8 }}>
                <Toggle label={t("builder.repeatable")} hint={t("builder.repeatableHint")} checked={s.repeatable} onChange={(val) => updateSec(s.id, (x) => ({ ...x, repeatable: val }))} disabled={!editable} />
                {s.repeatable ? <Field label={t("builder.repeatLabel")}><Input value={s.repeatLabel} onChange={(e) => updateSec(s.id, (x) => ({ ...x, repeatLabel: e.target.value }))} disabled={!editable} placeholder={t("builder.repeatLabelPh")} /></Field> : null}
              </div>
              {s.questions.map((q) => (
                <div key={q.id} className={`q${selQ === q.id ? " on" : ""}${over === q.id ? " drag-over" : ""}`} draggable={editable} onDragStart={() => setDrag({ sec: s.id, q: q.id })} onDragOver={(e) => { e.preventDefault(); setOver(q.id); }} onDragLeave={() => setOver(null)} onDrop={(e) => onDropQ(e, s.id, q.id)} data-qcode={q.code}>
                  {editable ? <span className="grip" aria-hidden><IconMenu size={16} /></span> : null}
                  <div className="qmain">
                    <div className="qtitle">
                      <span className="case">{q.code}</span>
                      <Input value={q.text.en} onChange={(e) => updateQ(s.id, q.id, (x) => ({ ...x, text: { ...x.text, en: e.target.value } }))} placeholder={t("builder.questionText")} disabled={!editable} aria-label={t("builder.questionText")} onFocus={() => setSelQ(q.id)} />
                      <Button size="sm" variant={selQ === q.id ? "primary" : "ghost"} icon onClick={() => setSelQ(selQ === q.id ? null : q.id)} aria-label={t("common.edit")} aria-expanded={selQ === q.id}><IconEdit size={14} /></Button>
                      {editable ? <><Button size="sm" variant="ghost" icon onClick={() => updateSec(s.id, (x) => { const i = x.questions.findIndex((y) => y.id === q.id); const copyQ = { ...q, id: uuid(), code: `${q.code}B` }; const qs = [...x.questions]; qs.splice(i + 1, 0, copyQ); return { ...x, questions: qs }; })} aria-label={t("builder.duplicate")}><IconCopy size={14} /></Button>
                        <Button size="sm" variant="ghost" icon onClick={() => updateSec(s.id, (x) => ({ ...x, questions: x.questions.filter((y) => y.id !== q.id) }))} aria-label={t("common.remove")}><IconTrash size={14} /></Button></> : null}
                    </div>
                    <div className="flags">
                      <Pill>{t(`answer.${q.answerType}`)}</Pill>
                      {q.required ? <Pill tone="blue">{t("common.required")}</Pill> : null}
                      {q.actionOnFail ? <Pill tone="orange">{t("builder.actionOnFail")}</Pill> : null}
                      {q.photoOnFail ? <Pill>{t("builder.photoOnFail")}</Pill> : null}
                      {q.showIf ? <Pill tone="grey">{t("builder.shownIf", { code: q.showIf.questionCode, value: q.showIf.equals })}</Pill> : null}
                      {q.referenceText ? <StatusTag label={q.referenceStatus} /> : null}
                    </div>
                    {selQ === q.id ? <QuestionEditor q={q} editable={editable} codes={allCodes.filter((c) => c !== q.code)} onChange={(nq) => updateQ(s.id, q.id, () => nq)} /> : null}
                  </div>
                </div>
              ))}
              {editable ? <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropQ(e, s.id, null)}><Button size="sm" onClick={() => updateSec(s.id, (x) => { const nq = newQuestion(x.questions.length); nq.code = `Q${allCodes.length + 1}`; setSelQ(nq.id); return { ...x, questions: [...x.questions, nq] }; })} data-testid="add-question"><IconPlus size={14} />{t("builder.addQuestion")}</Button></div> : null}
            </div>
          </div>
        ))}
        {editable ? <Button onClick={() => update((d) => ({ ...d, sections: [...d.sections, newSection(d.sections.length)] }))}><IconPlus size={16} />{t("builder.addSection")}</Button> : null}
        {problems.length && editable ? <div className="field invalid" style={{ marginTop: 10 }}>{problems.map((p, i) => <div className="error" key={i}>{p}</div>)}</div> : null}
        {err ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{err}</p></div> : null}
        {editable ? <div className="sticky-foot"><span className="small muted" style={{ marginRight: "auto", alignSelf: "center" }}>{dirty ? t("builder.unsaved") : t("builder.allSaved")}</span><Button variant="primary" loading={busy} disabled={!dirty || problems.length > 0} onClick={save} data-testid="save-template">{t("builder.save")}</Button></div> : null}
      </div>
      <div className="phone-col"><PhonePreview doc={doc} /></div>
    </div>
  );
}

function QuestionEditor({ q, editable, codes, onChange }: { q: Question; editable: boolean; codes: string[]; onChange: (q: Question) => void }) {
  const { t } = useI18n();
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch });
  const setOpt = (i: number, patch: Partial<ResponseOption>) => set({ responseSet: q.responseSet.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const choice = q.answerType === "single_choice" || q.answerType === "multi_choice" || q.answerType === "pass_fail_na";
  const canFail = choice || q.answerType === "number";
  return (
    <div className="q-editor">
      <div className="form-grid">
        <Field label={t("builder.code")} required><Input value={q.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s/g, "") })} disabled={!editable} maxLength={12} /></Field>
        <Field label={t("builder.answerType")}><Select value={q.answerType} onChange={(e) => { const at = e.target.value as AnswerType; set({ answerType: at, responseSet: at === "pass_fail_na" ? PASS_FAIL_NA.map((o) => ({ ...o })) : at === "single_choice" || at === "multi_choice" ? (q.responseSet.length && q.answerType !== "pass_fail_na" ? q.responseSet : [{ value: "opt1", label: { en: "" }, colour: "blue", flag: false, score: 1 }]) : [], actionOnFail: at === "pass_fail_na" || at === "number" || at === "single_choice" || at === "multi_choice" ? q.actionOnFail : false }); }} disabled={!editable}>{ANSWER_TYPES.map((a) => <option key={a} value={a}>{t(`answer.${a}`)}</option>)}</Select></Field>
      </div>
      <I18nInput label={t("builder.questionText")} required value={q.text} onChange={(val) => set({ text: val })} />
      <I18nInput label={t("builder.guidance")} textarea value={q.guidance} onChange={(val) => set({ guidance: val })} />
      <Field label={t("builder.guidanceImage")} optional hint={t("builder.guidanceImageHint")}><Input value={q.guidanceMediaUrl ?? ""} onChange={(e) => set({ guidanceMediaUrl: e.target.value || null })} disabled={!editable} placeholder="https://" /></Field>
      {choice ? (
        <div>
          <div className="label" style={{ marginBottom: 6 }}>{t("builder.responseSet")}</div>
          <div className="opt-row small muted"><span>{t("builder.optValue")}</span><span>{t("builder.optLabel")}</span><span>{t("matrix.colour")}</span><span>{t("builder.optFlag")}</span><span>{t("builder.optScore")}</span><span /></div>
          {q.responseSet.map((o, i) => (
            <div className="opt-row" key={i}>
              <Input value={o.value} onChange={(e) => setOpt(i, { value: e.target.value })} disabled={!editable} aria-label={t("builder.optValue")} />
              <Input value={o.label.en} onChange={(e) => setOpt(i, { label: { ...o.label, en: e.target.value } })} disabled={!editable} aria-label={t("builder.optLabel")} />
              <Select value={o.colour} onChange={(e) => setOpt(i, { colour: e.target.value as ResponseOption["colour"] })} disabled={!editable} aria-label={t("matrix.colour")}>{(["green", "red", "grey", "amber", "blue"] as const).map((c) => <option key={c} value={c}>{t(`colour.${c}`)}</option>)}</Select>
              <label className="chk" title={t("builder.optFlagHint")}><input type="checkbox" checked={o.flag} onChange={(e) => setOpt(i, { flag: e.target.checked })} disabled={!editable} /> <span className={`swatch ${o.colour}`} /></label>
              <Input type="number" value={o.score ?? ""} onChange={(e) => setOpt(i, { score: e.target.value === "" ? null : Number(e.target.value) })} disabled={!editable} aria-label={t("builder.optScore")} placeholder="N/A" />
              {editable ? <Button size="sm" variant="ghost" icon onClick={() => set({ responseSet: q.responseSet.filter((_, j) => j !== i) })} aria-label={t("common.remove")}><IconTrash size={14} /></Button> : <span />}
            </div>
          ))}
          {editable ? <Button size="sm" onClick={() => set({ responseSet: [...q.responseSet, { value: `opt${q.responseSet.length + 1}`, label: { en: "" }, colour: "blue", flag: false, score: 1 }] })}><IconPlus size={14} />{t("builder.addOption")}</Button> : null}
        </div>
      ) : null}
      {q.answerType === "number" ? (
        <div className="form-grid">
          <Field label={t("builder.unit")}><Input value={q.unit} onChange={(e) => set({ unit: e.target.value })} disabled={!editable} maxLength={12} /></Field>
          <Field label={t("builder.min")}><Input type="number" value={q.min ?? ""} onChange={(e) => set({ min: e.target.value === "" ? null : Number(e.target.value) })} disabled={!editable} /></Field>
          <Field label={t("builder.max")}><Input type="number" value={q.max ?? ""} onChange={(e) => set({ max: e.target.value === "" ? null : Number(e.target.value) })} disabled={!editable} /></Field>
          <Field label={t("builder.passMin")} hint={t("builder.passRangeHint")}><Input type="number" value={q.passMin ?? ""} onChange={(e) => set({ passMin: e.target.value === "" ? null : Number(e.target.value) })} disabled={!editable} /></Field>
          <Field label={t("builder.passMax")}><Input type="number" value={q.passMax ?? ""} onChange={(e) => set({ passMax: e.target.value === "" ? null : Number(e.target.value) })} disabled={!editable} /></Field>
        </div>
      ) : null}
      <div className="form-grid">
        <Toggle label={t("common.required")} checked={q.required} onChange={(val) => set({ required: val })} disabled={!editable} />
        {canFail ? <>
          <Toggle label={t("builder.photoOnFail")} checked={q.photoOnFail} onChange={(val) => set({ photoOnFail: val })} disabled={!editable} />
          <Toggle label={t("builder.noteOnFail")} checked={q.noteOnFail} onChange={(val) => set({ noteOnFail: val })} disabled={!editable} />
          <Toggle label={t("builder.actionOnFail")} hint={t("builder.actionOnFailHint")} checked={q.actionOnFail} onChange={(val) => set({ actionOnFail: val })} disabled={!editable} />
        </> : null}
      </div>
      {q.actionOnFail ? (
        <div className="action-draft">
          <div className="label" style={{ marginBottom: 6 }}>{t("builder.actionDefaults")}</div>
          <div className="form-grid">
            <Field label={t("builder.ownerRole")}><Select value={q.actionDefaults.ownerRole ?? ""} onChange={(e) => set({ actionDefaults: { ...q.actionDefaults, ownerRole: (e.target.value || undefined) as Role | undefined } })} disabled={!editable}><option value="">{t("builder.inspectorPicks")}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</Select></Field>
            <Field label={t("common.risk")}><Select value={q.actionDefaults.band ?? ""} onChange={(e) => set({ actionDefaults: { ...q.actionDefaults, band: (e.target.value || undefined) as Band | undefined } })} disabled={!editable}><option value="">{t("builder.inspectorPicks")}</option>{BANDS.map((b) => <option key={b} value={b}>{t(`band.${b}`)}</option>)}</Select></Field>
            <Field label={t("builder.dueOffset")} hint={t("builder.dueOffsetHint")}><Input type="number" min={1} value={q.actionDefaults.dueOffsetHours ?? ""} onChange={(e) => set({ actionDefaults: { ...q.actionDefaults, dueOffsetHours: e.target.value === "" ? undefined : Number(e.target.value) } })} disabled={!editable} /></Field>
            <Field label={t("triage.controlLevel")}><Select value={q.actionDefaults.controlLevel ?? ""} onChange={(e) => set({ actionDefaults: { ...q.actionDefaults, controlLevel: (e.target.value || undefined) as ControlLevel | undefined } })} disabled={!editable}><option value="">—</option>{CONTROLS.map((c) => <option key={c} value={c}>{t(`control.${c}`)}</option>)}</Select></Field>
          </div>
        </div>
      ) : null}
      <div className="form-grid">
        <Field label={t("builder.showIf")} hint={t("builder.showIfHint")}><Select value={q.showIf?.questionCode ?? ""} onChange={(e) => set({ showIf: e.target.value ? { questionCode: e.target.value, equals: q.showIf?.equals ?? "fail" } : null })} disabled={!editable}><option value="">{t("builder.alwaysShown")}</option>{codes.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
        {q.showIf ? <Field label={t("builder.equals")}><Input value={q.showIf.equals} onChange={(e) => set({ showIf: { ...q.showIf!, equals: e.target.value } })} disabled={!editable} /></Field> : null}
      </div>
      <Field label={t("builder.reference")} optional hint={t("builder.referenceHint")}><Textarea rows={2} value={q.referenceText} onChange={(e) => set({ referenceText: e.target.value })} disabled={!editable} maxLength={300} /></Field>
      <Field label={t("status.label")} hint={t("status.tagHint")}>{editable ? <StatusSelect value={q.referenceStatus} onChange={(val: StatusLabel) => set({ referenceStatus: val })} /> : <StatusTag label={q.referenceStatus} />}</Field>
    </div>
  );
}

/** How the field app will render the checklist on a phone. */
function PhonePreview({ doc }: { doc: TemplateVersion }) {
  const { t, pick } = useI18n();
  const [secIdx, setSecIdx] = useState(0);
  const sec = doc.sections[Math.min(secIdx, Math.max(0, doc.sections.length - 1))];
  useEffect(() => { if (secIdx >= doc.sections.length) setSecIdx(0); }, [doc.sections.length, secIdx]);
  const total = doc.sections.length;
  return (
    <div>
      <div className="kicker" style={{ textAlign: "center", marginBottom: 6 }}>{t("builder.preview")}</div>
      <div className="phone" aria-label={t("builder.preview")}>
        <div className="notch"><span /></div>
        <div className="ptop">{pick(doc.name) || t("templates.name")}<div className="small" style={{ fontFamily: "var(--font)", fontWeight: 400, opacity: .8 }}>{sec ? `${secIdx + 1}/${total} · ${pick(sec.title) || t("builder.sectionTitle")}` : ""}</div></div>
        <div className="progress" style={{ borderRadius: 0, height: 4 }}><span style={{ width: `${total ? ((secIdx + 1) / total) * 100 : 0}%` }} /></div>
        <div className="pbody">
          {!sec ? <div className="pq muted">{t("builder.previewEmpty")}</div> : null}
          {sec?.repeatable ? <div className="psec">{sec.repeatLabel || t("builder.repeatable")} #1</div> : null}
          {sec?.questions.map((q) => (
            <div className="pq" key={q.id}>
              <div className="qt">{pick(q.text) || <span className="muted">{q.code}</span>}{q.required ? <span className="req"> *</span> : null}</div>
              {q.guidance.en ? <div className="guide">{pick(q.guidance)}</div> : null}
              {q.answerType === "pass_fail_na" || q.answerType === "single_choice" || q.answerType === "multi_choice" ? <div className="seg">{q.responseSet.map((o) => <span key={o.value} className={o.colour}>{pick(o.label) || o.value}</span>)}</div> : null}
              {q.answerType === "number" ? <div className="row nowrap"><div className="fake grow" /><span className="small muted">{q.unit}</span></div> : null}
              {q.answerType === "text" ? <div className="fake" /> : null}
              {q.answerType === "date" ? <div className="fake" /> : null}
              {q.answerType === "photo" ? <div className="fake" style={{ height: 56, display: "grid", placeItems: "center" }}><span className="small muted">📷 {t("common.addPhoto")}</span></div> : null}
              {q.answerType === "signature" ? <div className="fake" style={{ height: 56, borderStyle: "dashed" }} /> : null}
              {q.photoOnFail || q.noteOnFail || q.actionOnFail ? <div className="small muted" style={{ marginTop: 4 }}>{[q.photoOnFail ? t("builder.photoOnFail") : "", q.noteOnFail ? t("builder.noteOnFail") : "", q.actionOnFail ? t("builder.actionOnFail") : ""].filter(Boolean).join(" · ")}</div> : null}
              {q.showIf ? <div className="small muted">{t("builder.shownIf", { code: q.showIf.questionCode, value: q.showIf.equals })}</div> : null}
              {q.referenceText ? <div className="ref">{q.referenceText} · {t(`common.verifyLabel.${q.referenceStatus}`)}</div> : null}
            </div>
          ))}
        </div>
        <div className="pfoot row nowrap">
          <Button size="sm" onClick={() => setSecIdx((i) => Math.max(0, i - 1))} disabled={secIdx === 0}>{t("common.back")}</Button>
          <span className="grow" />
          <Button size="sm" variant="primary" onClick={() => setSecIdx((i) => Math.min(total - 1, i + 1))} disabled={secIdx >= total - 1}>{secIdx >= total - 1 ? t("builder.submitRun") : t("common.next")}</Button>
        </div>
      </div>
      <p className="small muted" style={{ textAlign: "center", marginTop: 8 }}>{doc.scoring.anyFailRule ? t("builder.anyFailOn") : t("builder.passMarkOnly", { pct: doc.scoring.passMarkPct })}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ schedules */
function SchedulesTab() {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { siteId, siteName, sites } = useScope();
  const state = useLoad(() => api.get("/admin/inspections/schedules", { siteId: siteId || undefined }).then((r) => asList<Schedule>(r)), [siteId]);
  const templates = useLoad(() => api.get("/admin/inspections/templates").then((r) => asList<TemplateVersion>(r)), []);
  const [edit, setEdit] = useState<Partial<Schedule> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const canEdit = perms.canSiteConfig(siteId || null) && !perms.readOnly;
  const rows = (state.data ?? []).filter((s) => !hidden.has(s.id));
  const tplName = (id: string) => { const v = templates.data?.find((x) => x.templateId === id); return v ? `${v.code} · ${pick(v.name)}` : id; };
  const freq = (s: Schedule) => `${t("sched.every", { n: s.frequency.every, unit: t(`sched.unit.${s.frequency.unit}`) })}${s.frequency.weekdays?.length ? ` (${s.frequency.weekdays.map((d) => t(`day.${d}`)).join(", ")})` : ""} · ${s.frequency.time}`;
  const remove = (s: Schedule) => {
    setHidden((h) => new Set(h).add(s.id));
    toast.undoable(t("sched.removed"), async () => { try { await api.del(`/admin/inspections/schedules/${s.id}`); state.reload(); } catch (e) { toast.error(errMessage(e)); } setHidden((h) => { const n = new Set(h); n.delete(s.id); return n; }); }, () => setHidden((h) => { const n = new Set(h); n.delete(s.id); return n; }));
  };
  const blank = (): Partial<Schedule> => ({ templateId: templates.data?.[0]?.templateId ?? "", siteId: siteId || sites[0]?.id || "", areaId: null, assetId: null, frequency: { every: 1, unit: "week", weekdays: [1], time: "09:00" }, assigneeUserId: null, assigneeRole: "site_safety_officer", leadDays: 1, graceHours: 24, active: true });
  const columns: Column<Schedule>[] = [
    { key: "template", label: t("templates.template"), render: (s) => <div><div className="cell-title">{tplName(s.templateId)}</div><div className="cell-sub">{!siteId ? siteName(s.siteId) : ""}{s.areaId ? ` · ${t("common.area")}` : s.assetId ? ` · ${t("common.asset")}` : ` · ${t("sched.wholeSite")}`}</div></div> },
    { key: "freq", label: t("sched.frequency"), render: (s) => freq(s) },
    { key: "assignee", label: t("sched.assignee"), render: (s) => s.assigneeRole ? t(`role.${s.assigneeRole}`) : s.assigneeUserId ? t("sched.namedUser") : "—", width: 160 },
    { key: "lead", label: t("sched.leadGrace"), render: (s) => `${t("common.days", { count: s.leadDays })} / ${t("common.hours", { count: s.graceHours })}`, width: 120 },
    { key: "next", label: t("sched.nextDue"), render: (s) => s.nextDueAt ? fmtDateTime(s.nextDueAt, lang) : <span className="muted">—</span>, width: 150 },
    { key: "active", label: t("common.status"), render: (s) => <Pill tone={s.active ? "green" : "grey"}>{s.active ? t("sites.active") : t("sites.inactive")}</Pill>, width: 90 },
    { key: "tools", label: "", render: (s) => canEdit ? <span className="row-actions"><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); setEdit(s); }} aria-label={t("common.edit")}><IconEdit size={14} /></Button><Button size="sm" variant="ghost" icon onClick={(e) => { e.stopPropagation(); remove(s); }} aria-label={t("common.remove")}><IconTrash size={14} /></Button></span> : null, width: 80 },
  ];
  return (
    <div className="stack">
      <div className="row between">
        <span className="small muted">{siteId ? siteName(siteId) : t("top.allSites")} · {t("sched.count", { count: rows.length })}</span>
        <span className="btn-group">
          <ExportButton onExport={async () => localCsv(rows.map((s) => ({ template: tplName(s.templateId), site: siteName(s.siteId), frequency: freq(s), assignee: s.assigneeRole ?? s.assigneeUserId ?? "", lead_days: s.leadDays, grace_hours: s.graceHours, next_due: s.nextDueAt ?? "", active: s.active })), "schedules.csv")} />
          {canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit(blank())}><IconPlus size={14} />{t("sched.new")}</Button> : null}
        </span>
      </div>
      {state.error && !state.data ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} loading={state.loading && !state.data} onRow={canEdit ? (s) => setEdit(s) : undefined}
        empty={<EmptyState icon={<IconCalendar />} title={t("sched.empty")} body={t("sched.emptyHint")} action={canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit(blank())}>{t("sched.new")}</Button> : undefined} />} />
      {edit ? <ScheduleSheet s={edit} templates={templates.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); }} /> : null}
    </div>
  );
}

function ScheduleSheet({ s, templates, onClose, onSaved }: { s: Partial<Schedule>; templates: TemplateVersion[]; onClose: () => void; onSaved: () => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { sites } = useScope();
  const [f, setF] = useState<Partial<Schedule>>(s);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const { areas } = useSiteAreas(f.siteId);
  useEffect(() => setF(s), [s]);
  const fr = f.frequency ?? { every: 1, unit: "week" as const, time: "09:00" };
  const valid = !!f.templateId && !!f.siteId && fr.every >= 1 && !!fr.time && (!!f.assigneeRole || !!f.assigneeUserId);
  const nextDue = useMemo(() => { const d = new Date(); const [h, m] = fr.time.split(":").map(Number); d.setHours(h || 9, m || 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + (fr.unit === "day" ? fr.every : fr.unit === "week" ? 7 * fr.every : 30 * fr.every)); return d; }, [fr]);
  return (
    <Sheet title={s.id ? t("sched.edit") : t("sched.new")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={async () => { setBusy(true); setErr(""); try { if (s.id) await api.put(`/admin/inspections/schedules/${s.id}`, f); else await api.post("/admin/inspections/schedules", f); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("common.save")}</Button></>}>
      <div className="form-grid">
        <Field label={t("templates.template")} required><Select value={f.templateId ?? ""} onChange={(e) => setF({ ...f, templateId: e.target.value })}><option value="">—</option>{templates.map((v) => <option key={v.templateId} value={v.templateId}>{v.code} · {pick(v.name)}</option>)}</Select></Field>
        <Field label={t("common.site")} required><Select value={f.siteId ?? ""} onChange={(e) => setF({ ...f, siteId: e.target.value, areaId: null, assetId: null })}>{sites.map((x) => <option key={x.id} value={x.id}>{x.code} · {pick(x.name)}</option>)}</Select></Field>
        <Field label={t("common.area")} hint={t("sched.areaHint")}><Select value={f.areaId ?? ""} onChange={(e) => setF({ ...f, areaId: e.target.value || null })}><option value="">{t("sched.wholeSite")}</option>{areas.map((a) => <option key={a.id} value={a.id}>{pick(a.name)}</option>)}</Select></Field>
        <Field label={t("sched.assetTag")} optional hint={t("sched.assetHint")}><Input value={f.assetId ?? ""} onChange={(e) => setF({ ...f, assetId: e.target.value || null })} /></Field>
      </div>
      <div className="section-title">{t("sched.frequency")}</div>
      <div className="form-grid schedule-row">
        <Field label={t("sched.every")}><Input type="number" min={1} max={52} value={fr.every} onChange={(e) => setF({ ...f, frequency: { ...fr, every: Number(e.target.value) } })} /></Field>
        <Field label={t("due.unit")}><Select value={fr.unit} onChange={(e) => setF({ ...f, frequency: { ...fr, unit: e.target.value as "day" | "week" | "month", weekdays: e.target.value === "week" ? fr.weekdays ?? [1] : undefined } })}><option value="day">{t("sched.unit.day")}</option><option value="week">{t("sched.unit.week")}</option><option value="month">{t("sched.unit.month")}</option></Select></Field>
        <Field label={t("common.time")}><Input type="time" value={fr.time} onChange={(e) => setF({ ...f, frequency: { ...fr, time: e.target.value } })} /></Field>
      </div>
      {fr.unit === "week" ? <Field label={t("sched.weekdays")}><ChipsSelect ariaLabel={t("sched.weekdays")} options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: t(`day.${d}`) }))} value={(fr.weekdays ?? []).map(String)} onChange={(v) => setF({ ...f, frequency: { ...fr, weekdays: v.map(Number) } })} /></Field> : null}
      <div className="section-title">{t("sched.assignee")}</div>
      <div className="form-grid">
        <Field label={t("users.role")} hint={t("sched.roleHint")}><Select value={f.assigneeRole ?? ""} onChange={(e) => setF({ ...f, assigneeRole: (e.target.value || null) as Role | null, assigneeUserId: e.target.value ? null : f.assigneeUserId })}><option value="">{t("sched.namedUser")}</option>{(["site_safety_officer", "site_head", "verifier", "action_owner", "reporter"] as Role[]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</Select></Field>
        {!f.assigneeRole ? <UserPicker label={t("sched.namedUser")} required value={f.assigneeUserId ?? ""} valueName={assigneeName || undefined} siteId={f.siteId} onChange={(id, u) => { setF({ ...f, assigneeUserId: id || null }); setAssigneeName(u?.name ?? ""); }} /> : null}
        <Field label={t("sched.leadDays")} hint={t("sched.leadHint")}><Input type="number" min={0} max={30} value={f.leadDays ?? 1} onChange={(e) => setF({ ...f, leadDays: Number(e.target.value) })} /></Field>
        <Field label={t("sched.graceHours")} hint={t("sched.graceHint")}><Input type="number" min={0} max={720} value={f.graceHours ?? 24} onChange={(e) => setF({ ...f, graceHours: Number(e.target.value) })} /></Field>
      </div>
      {s.id ? <Toggle label={t("sites.active")} checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} /> : null}
      <KV rows={[{ k: t("sched.nextDue"), v: s.nextDueAt ? fmtDateTime(s.nextDueAt) : `${fmtDateTime(nextDue.toISOString())} (${t("sched.estimated")})` }]} />
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
      <ChipBar><Chip disabled>{t("sched.missedRule", { h: f.graceHours ?? 24 })}</Chip></ChipBar>
    </Sheet>
  );
}
