/* Sites: list → 3-step wizard (name → industry → create, then posters) → site tabs: details, areas (tree, drag reorder, CSV import), equipment, QR. */
import { useEffect, useState, type DragEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { Area, AreaType, EstablishmentType, I18n, IndustryProfile, RuleSet, Site, ImportResult } from "../../shared/types";
import { Button, Card, CardHead, Chip, ChipBar, DataTable, EmptyState, ErrorCard, Field, Form, Input, Pill, SearchEmpty, Select, Sheet, Skeleton, Tabs, Textarea, Toggle, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { fmtDate } from "../../shared/format";
import { IconCheckCircle, IconExternal, IconFactory, IconHelmet, IconMenu, IconPlus, IconPrint, IconSite, IconTrash, IconTruck, IconEdit } from "../../shared/icons";
import { api, asList, errMessage, openServerHtml } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import type { SiteSetupResult } from "../types";
import { CsvImport, I18nInput, KV, PageHead, ReasonSheet, StatusTag, UserPicker, ChipsSelect } from "../components";
import { AssetsRegister } from "./Assets";

const EST_TYPES: EstablishmentType[] = ["factory", "hazardous_process_factory", "construction_site", "mine", "port", "plantation", "office", "other"];
const AREA_TYPES: AreaType[] = ["production", "utilities", "store", "yard", "scaffold_zone", "excavation_zone", "substation", "office", "canteen", "gate", "labour_camp", "loading_bay", "other"];
const STATES = ["Tamil Nadu", "Karnataka", "Kerala", "Andhra Pradesh", "Telangana", "Maharashtra", "Gujarat", "Delhi", "Uttar Pradesh", "West Bengal", "Odisha", "Rajasthan", "Madhya Pradesh", "Haryana", "Punjab", "Bihar", "Jharkhand", "Chhattisgarh", "Goa", "Assam", "Other"];
const DEFAULT_AREAS: Record<string, string[]> = {
  construction_site: ["Gate", "Stores and laydown", "Block A levels", "Scaffold zone", "Excavation zone", "Batching plant", "Office", "Canteen", "Labour camp"],
  factory: ["Gate", "Production hall", "Utilities", "Substation", "Stores", "Loading bay", "Canteen", "Office"],
  hazardous_process_factory: ["Gate", "Process area", "Tank farm", "Utilities", "Substation", "Stores", "Loading bay", "Control room", "Canteen", "Office"],
  mine: ["Gate", "Pit", "Haul road", "Crusher", "Workshop", "Explosives magazine", "Stores", "Office"],
  port: ["Gate", "Berth", "Container yard", "Warehouse", "Workshop", "Office"],
  plantation: ["Gate", "Field block A", "Processing shed", "Stores", "Office", "Labour lines"],
  office: ["Reception", "Floors", "Pantry", "Utilities", "Parking"],
  other: ["Gate", "Main area", "Stores", "Office"],
};
type IndustryExt = IndustryProfile & { defaultAreas?: string[] };

function emptySite(): Partial<Site> {
  return { code: "", name: { en: "" }, address: "", state: "Tamil Nadu", district: "", lat: null, lng: null, geofenceRadiusM: 300, industryCode: null, establishmentType: "construction_site", appropriateGovernment: "state", ruleSetCode: null, ruleSetEffectiveFrom: null, riskMatrixVersionId: null, hazardousProcess: false, workingCalendar: { weeklyOff: [0], shiftStart: "08:00", shiftEnd: "17:00" }, workerCount: null, siteHeadUserId: null, active: true };
}

export default function Sites() {
  const { id, tab } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  if (loc.pathname.endsWith("/sites/new")) return <SiteWizard onDone={(sid) => nav(`/sites/${sid}`)} />;
  if (id) return <SiteDetail id={id} tab={(tab as "details" | "areas" | "equipment" | "qr") ?? "details"} />;
  return <SiteList />;
}

function SiteList() {
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const { perms } = useAuth();
  const { sites, reloadSites, matrices } = useScope();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const ruleSets = useLoad(() => api.get("/admin/rule-sets").then((r) => asList<RuleSet>(r)), []);
  useEffect(() => { setLoading(true); reloadSites().catch(setErr).finally(() => setLoading(false)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const rows = sites.filter((s) => !q || `${s.code} ${pick(s.name)} ${s.district} ${s.state}`.toLowerCase().includes(q.toLowerCase()));
  const columns: Column<Site>[] = [
    { key: "code", label: t("sites.code"), render: (s) => <span className="case">{s.code}</span>, width: 90 },
    { key: "name", label: t("sites.name"), render: (s) => <div><div className="cell-title">{pick(s.name)}</div><div className="cell-sub">{s.district}{s.district && s.state ? ", " : ""}{s.state}</div></div> },
    { key: "type", label: t("sites.type"), render: (s) => <div>{t(`est.${s.establishmentType}`)}<div className="cell-sub">{s.industryCode ?? "—"} · {t(`sites.gov.${s.appropriateGovernment}`)}</div></div> },
    { key: "ruleSet", label: t("sites.ruleSet"), render: (s) => { const rs = ruleSets.data?.find((r) => r.code === s.ruleSetCode); return s.ruleSetCode ? <div><span className="mono-sm">{s.ruleSetCode}</span> <StatusTag label={rs?.status} /><div className="cell-sub">{s.ruleSetEffectiveFrom ? `${t("sites.effectiveFrom")} ${fmtDate(s.ruleSetEffectiveFrom, lang)}` : ""}</div></div> : <span className="muted">{t("sites.noRuleSet")}</span>; } },
    { key: "matrix", label: t("nav.riskMatrix"), render: (s) => { const m = matrices.data.find((x) => x.id === s.riskMatrixVersionId); return m ? `${m.name} v${m.version}` : <span className="muted">{t("sites.matrixDefault")}</span>; }, width: 150 },
    { key: "active", label: t("common.status"), render: (s) => <Pill tone={s.active ? "green" : "grey"}>{s.active ? t("sites.active") : t("sites.inactive")}</Pill>, width: 100 },
  ];
  return (
    <>
      <PageHead title={t("nav.sites")} sub={t("sites.sub", { count: sites.length })} tools={perms.isAdmin ? <Button variant="primary" onClick={() => nav("/sites/new")}><IconPlus size={16} />{t("sites.new")}</Button> : null} />
      <div className="filters"><div className="field grow-search"><label>{t("common.search")}</label><Input data-register-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("sites.searchPh")} /></div></div>
      {err ? <ErrorCard error={err} onRetry={() => { setErr(null); setLoading(true); reloadSites().catch(setErr).finally(() => setLoading(false)); }} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} loading={loading && sites.length === 0} onRow={(s) => nav(`/sites/${s.id}`)}
        empty={q ? <SearchEmpty q={q} onClear={() => setQ("")} /> : <EmptyState icon={<IconSite />} title={t("sites.empty")} body={t("sites.emptyHint")} action={perms.isAdmin ? <Button variant="primary" onClick={() => nav("/sites/new")}><IconPlus size={16} />{t("sites.new")}</Button> : undefined} />} />
    </>
  );
}

/* ------------------------------------------------------------------ wizard */
function SiteWizard({ onDone }: { onDone: (siteId: string) => void }) {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { industries, loadIndustries, reloadSites, categories } = useScope();
  const [step, setStep] = useState(1);
  const [site, setSite] = useState<Partial<Site>>(emptySite());
  const [industry, setIndustry] = useState<IndustryExt | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [newArea, setNewArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ site: Site; setup: SiteSetupResult } | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  useEffect(() => { loadIndustries().catch(() => undefined); }, [loadIndustries]);
  const list = industries.data as IndustryExt[];
  const pickIndustry = (i: IndustryExt) => {
    setIndustry(i);
    const est = i.establishmentTypes[0] ?? site.establishmentType ?? "other";
    setSite((s) => ({ ...s, industryCode: i.code, establishmentType: i.establishmentTypes.includes(s.establishmentType as EstablishmentType) ? s.establishmentType : est }));
    setAreas(i.defaultAreas ?? DEFAULT_AREAS[est] ?? DEFAULT_AREAS.other);
  };
  const validate1 = () => {
    const fe: Record<string, string> = {};
    if (!site.name?.en?.trim()) fe.name = t("csv.required");
    if (!/^[A-Z0-9]{2,8}$/.test(site.code ?? "")) fe.code = t("sites.codeRule");
    if (!site.district?.trim()) fe.district = t("csv.required");
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  };
  const create = async () => {
    setBusy(true); setErr("");
    try {
      const created = await api.post<Site>("/admin/sites", { ...site, name: site.name, code: site.code?.toUpperCase() });
      const setup = await api.post<SiteSetupResult>(`/admin/sites/${created.id}/setup`, { industryCode: industry?.code, areas });
      await reloadSites();
      setResult({ site: created, setup });
      toast.success(t("sites.created", { name: pick(created.name) }));
    } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
  };
  const Steps = () => (
    <div className="wizard-steps" aria-label={t("sites.wizard")}>
      {[1, 2, 3].map((n) => (<span key={n} style={{ display: "contents" }}><span className={`st${step === n ? " on" : step > n ? " done" : ""}`}><span className="n">{step > n ? "✓" : n}</span>{t(`sites.step${n}`)}</span>{n < 3 ? <span className="sep" /> : null}</span>))}
    </div>
  );
  if (result) {
    return (
      <>
        <PageHead title={t("sites.readyTitle", { name: pick(result.site.name) })} sub={t("sites.readySub", { areas: result.setup.areasCreated, templates: result.setup.templatesEnabled?.length ?? 0, categories: result.setup.categoriesEnabled?.length ?? 0 })} />
        <Card>
          <div className="row" style={{ marginBottom: 10 }}><IconCheckCircle style={{ color: "var(--green)" }} /><h3 style={{ margin: 0 }}>{t("sites.postersTitle")}</h3></div>
          <p className="small muted">{t("sites.postersHint")}</p>
          <div className="poster-list">
            {(result.setup.posters ?? []).map((p) => (
              <div className="pr" key={p.qrCodeId}>
                <span className="grow"><strong>{p.label}</strong> <span className="small muted">· {t(`qr.target.${p.targetType}`)}</span></span>
                <Button size="sm" onClick={() => openServerHtml(`/admin/qr-codes/${p.qrCodeId}/poster`, { lang: "en,hi,ta,kn", size: "A4" })}><IconPrint size={14} />{t("qr.printPoster")} A4</Button>
                <Button size="sm" variant="ghost" onClick={() => openServerHtml(`/admin/qr-codes/${p.qrCodeId}/poster`, { lang: "en,hi,ta,kn", size: "A5" })}>A5</Button>
              </div>
            ))}
            {(result.setup.posters ?? []).length === 0 ? <p className="small muted">{t("sites.noPosters")}</p> : null}
          </div>
          <div className="btn-group" style={{ marginTop: 14 }}>
            <Button variant="primary" onClick={() => onDone(result.site.id)}>{t("sites.openSite")}</Button>
            <Link className="btn" to="/users">{t("sites.nextPeople")}</Link>
            <Link className="btn" to={`/qr?siteId=${result.site.id}`}>{t("nav.qr")}</Link>
          </div>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHead title={t("sites.new")} sub={t("sites.wizardSub")} />
      <Steps />
      {step === 1 ? (
        <Card>
          <Form onSubmit={() => { if (validate1()) setStep(2); }}>
            <div className="form-grid">
              <Field label={t("sites.name")} required hint={t("sites.nameHint")} error={fieldErr.name}><Input value={site.name?.en ?? ""} onChange={(e) => setSite({ ...site, name: { ...(site.name as I18n), en: e.target.value } })} autoFocus /></Field>
              <Field label={t("sites.code")} required hint={t("sites.codeRule")} error={fieldErr.code}><Input value={site.code ?? ""} onChange={(e) => setSite({ ...site, code: e.target.value.toUpperCase() })} maxLength={8} style={{ textTransform: "uppercase" }} /></Field>
              <Field label={t("sites.state")} required><Select value={site.state} onChange={(e) => setSite({ ...site, state: e.target.value })}>{STATES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
              <Field label={t("sites.district")} required error={fieldErr.district}><Input value={site.district ?? ""} onChange={(e) => setSite({ ...site, district: e.target.value })} /></Field>
              <Field label={t("sites.type")} required><Select value={site.establishmentType} onChange={(e) => setSite({ ...site, establishmentType: e.target.value as EstablishmentType })}>{EST_TYPES.map((x) => <option key={x} value={x}>{t(`est.${x}`)}</option>)}</Select></Field>
              <Field label={t("sites.gov")} required hint={t("sites.govHint")}><Select value={site.appropriateGovernment} onChange={(e) => setSite({ ...site, appropriateGovernment: e.target.value as "state" | "centre" })}><option value="state">{t("sites.gov.state")}</option><option value="centre">{t("sites.gov.centre")}</option></Select></Field>
              <div className="full"><Field label={t("sites.address")} optional><Textarea rows={2} value={site.address ?? ""} onChange={(e) => setSite({ ...site, address: e.target.value })} maxLength={300} /></Field></div>
            </div>
            <div className="btn-group"><Button variant="primary" type="submit">{t("common.next")}: {t("sites.step2")}</Button><Button variant="ghost" onClick={() => nav("/sites")}>{t("common.cancel")}</Button></div>
          </Form>
        </Card>
      ) : null}
      {step === 2 ? (
        <div className="stack">
          {industries.error ? <ErrorCard error={industries.error} onRetry={() => loadIndustries()} /> : null}
          {!industries.loaded ? <div className="tiles">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} block className="tile" />)}</div> : null}
          {industries.loaded && list.length === 0 ? <EmptyState title={t("sites.noIndustries")} body={t("sites.noIndustriesHint")} /> : null}
          <div className="tiles">
            {list.map((i) => (
              <button key={i.code} type="button" className="tile" aria-pressed={industry?.code === i.code} onClick={() => pickIndustry(i)} data-industry={i.code}>
                <span className="ico">{i.code.toLowerCase().includes("constr") ? <IconHelmet /> : i.code.toLowerCase().includes("port") || i.code.toLowerCase().includes("logist") ? <IconTruck /> : <IconFactory />}</span>
                <span className="nm">{pick(i.name)}</span>
                <span className="tg">{i.tagline}</span>
                <span className="small muted">{t("sites.brings", { c: i.categoryCodes.length, tpl: i.templateCodes.length })}</span>
              </button>
            ))}
          </div>
          {industry ? (
            <Card>
              <CardHead title={t("sites.preview", { name: pick(industry.name) })} kicker={t("sites.previewKicker")} />
              <div className="preview-cols">
                <div><strong>{t("common.categories")} ({industry.categoryCodes.length})</strong><ul>{industry.categoryCodes.map((c) => <li key={c}>{pick(categories.data.find((x) => x.code === c)?.name) || c}</li>)}</ul></div>
                <div><strong>{t("nav.templates")} ({industry.templateCodes.length})</strong><ul>{industry.templateCodes.map((c) => <li key={c}>{c}</li>)}</ul></div>
                <div>
                  <strong>{t("sites.defaultAreas")} ({areas.length})</strong>
                  <p className="small muted" style={{ margin: "4px 0" }}>{t("sites.areasHint")}</p>
                  <ChipBar wrap>{areas.map((a) => <Chip key={a} on onClick={() => setAreas(areas.filter((x) => x !== a))} title={t("common.remove")}>{a} ×</Chip>)}</ChipBar>
                  <form className="input-row" style={{ marginTop: 6 }} onSubmit={(e) => { e.preventDefault(); if (newArea.trim() && !areas.includes(newArea.trim())) setAreas([...areas, newArea.trim()]); setNewArea(""); }}>
                    <Input value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder={t("sites.addArea")} /><Button type="submit" size="sm"><IconPlus size={14} /></Button>
                  </form>
                </div>
              </div>
              {industry.hazards?.length ? <p className="small muted" style={{ marginTop: 10 }}>{t("sites.hazards")}: {industry.hazards.join(", ")}</p> : null}
            </Card>
          ) : null}
          <div className="btn-group"><Button onClick={() => setStep(1)}>{t("common.back")}</Button><Button variant="primary" disabled={!industry} onClick={() => setStep(3)}>{t("common.next")}: {t("sites.step3")}</Button></div>
        </div>
      ) : null}
      {step === 3 ? (
        <Card>
          <CardHead title={t("sites.review")} />
          <KV rows={[{ k: t("sites.name"), v: site.name?.en }, { k: t("sites.code"), v: site.code }, { k: t("sites.state"), v: `${site.district}, ${site.state}` }, { k: t("sites.type"), v: t(`est.${site.establishmentType}`) }, { k: t("sites.gov"), v: t(`sites.gov.${site.appropriateGovernment}`) }, { k: t("sites.industry"), v: industry ? pick(industry.name) : "" }, { k: t("sites.defaultAreas"), v: areas.join(", ") }]} />
          <p className="small muted" style={{ marginTop: 10 }}>{t("sites.createNote")}</p>
          {err ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{err}</p></div> : null}
          <div className="btn-group" style={{ marginTop: 10 }}><Button onClick={() => setStep(2)}>{t("common.back")}</Button><Button variant="primary" loading={busy} onClick={create} data-testid="create-site">{t("sites.create")}</Button></div>
        </Card>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ detail */
function SiteDetail({ id, tab }: { id: string; tab: "details" | "areas" | "equipment" | "qr" }) {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const { sites, reloadSites } = useScope();
  const site = sites.find((s) => s.id === id) ?? null;
  const state = useLoad(() => api.get<Site>(`/admin/sites/${id}`), [id]);
  const s = state.data ?? site;
  useEffect(() => { if (tab === "qr") nav(`/qr?siteId=${id}`, { replace: true }); }, [tab, id, nav]);
  if (state.error && !s) return <ErrorCard error={state.error} onRetry={state.reload} />;
  if (!s) return <Skeleton lines={6} />;
  return (
    <>
      <PageHead title={pick(s.name)} sub={`${s.code} · ${t(`est.${s.establishmentType}`)} · ${s.district}, ${s.state}`} tools={<Link className="btn sm" to="/sites">{t("sites.allSites")}</Link>} />
      <Tabs value={tab} onChange={(v) => nav(`/sites/${id}/${v}`)} tabs={[{ value: "details", label: t("sites.tab.details") }, { value: "areas", label: t("sites.tab.areas") }, { value: "equipment", label: t("nav.equipment") }, { value: "qr", label: t("nav.qr") }]} />
      <div style={{ marginTop: 14 }}>
        {tab === "details" ? <SiteForm site={s} onSaved={(ns) => { state.setData(ns); void reloadSites(); }} /> : null}
        {tab === "areas" ? <AreasTab siteId={id} /> : null}
        {tab === "equipment" ? <AssetsRegister siteId={id} /> : null}
      </div>
    </>
  );
}

function SiteForm({ site, onSaved }: { site: Site; onSaved: (s: Site) => void }) {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const { perms } = useAuth();
  const { industries, loadIndustries, matrices, reloadSites } = useScope();
  const [f, setF] = useState<Site>(site);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ruleErr, setRuleErr] = useState("");
  const [del, setDel] = useState(false);
  const [headName, setHeadName] = useState("");
  const ruleSets = useLoad(() => api.get("/admin/rule-sets").then((r) => asList<RuleSet>(r)), []);
  useEffect(() => { setF(site); }, [site]);
  useEffect(() => { loadIndustries().catch(() => undefined); }, [loadIndustries]);
  const rs = ruleSets.data?.find((r) => r.code === f.ruleSetCode);
  const readOnly = perms.readOnly || !perms.isAdmin;
  const save = async () => {
    setBusy(true); setErr(""); setRuleErr("");
    try {
      const { ruleSetCode, ruleSetEffectiveFrom, riskMatrixVersionId, ...rest } = f;
      let saved = await api.put<Site>(`/admin/sites/${site.id}`, { ...rest, name: f.name, workerCount: f.workerCount ?? null });
      if (ruleSetCode !== site.ruleSetCode || ruleSetEffectiveFrom !== site.ruleSetEffectiveFrom) {
        try { saved = await api.post<Site>(`/admin/sites/${site.id}/rule-set`, { code: ruleSetCode, effectiveFrom: ruleSetEffectiveFrom }); }
        catch (e) { setRuleErr(errMessage(e)); setF((x) => ({ ...x, ruleSetCode: site.ruleSetCode, ruleSetEffectiveFrom: site.ruleSetEffectiveFrom })); }
      }
      if (riskMatrixVersionId !== site.riskMatrixVersionId) saved = await api.post<Site>(`/admin/sites/${site.id}/risk-matrix`, { versionId: riskMatrixVersionId });
      onSaved({ ...saved, ruleSetCode: ruleErr ? site.ruleSetCode : saved.ruleSetCode });
      toast.success(t("common.saved"));
    } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Form onSubmit={save}>
      <div className="two-col">
        <Card>
          <CardHead title={t("sites.identity")} />
          <I18nInput label={t("sites.name")} required value={f.name} onChange={(v) => setF({ ...f, name: v })} />
          <div className="form-grid">
            <Field label={t("sites.code")} required><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={8} disabled={readOnly} /></Field>
            <Field label={t("sites.type")}><Select value={f.establishmentType} onChange={(e) => setF({ ...f, establishmentType: e.target.value as EstablishmentType })} disabled={readOnly}>{EST_TYPES.map((x) => <option key={x} value={x}>{t(`est.${x}`)}</option>)}</Select></Field>
            <Field label={t("sites.state")}><Select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} disabled={readOnly}>{STATES.map((s) => <option key={s}>{s}</option>)}{!STATES.includes(f.state) ? <option>{f.state}</option> : null}</Select></Field>
            <Field label={t("sites.district")}><Input value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} disabled={readOnly} /></Field>
            <div className="full"><Field label={t("sites.address")}><Textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} disabled={readOnly} maxLength={300} /></Field></div>
            <Field label={t("sites.industry")}><Select value={f.industryCode ?? ""} onChange={(e) => setF({ ...f, industryCode: e.target.value || null })} disabled={readOnly}><option value="">—</option>{industries.data.map((i) => <option key={i.code} value={i.code}>{pick(i.name)}</option>)}{f.industryCode && !industries.data.some((i) => i.code === f.industryCode) ? <option value={f.industryCode}>{f.industryCode}</option> : null}</Select></Field>
            <Field label={t("sites.gov")} hint={t("sites.govHint")}><Select value={f.appropriateGovernment} onChange={(e) => setF({ ...f, appropriateGovernment: e.target.value as "state" | "centre" })} disabled={readOnly}><option value="state">{t("sites.gov.state")}</option><option value="centre">{t("sites.gov.centre")}</option></Select></Field>
            <Field label={t("sites.workerCount")} optional><Input type="number" min={0} value={f.workerCount ?? ""} onChange={(e) => setF({ ...f, workerCount: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} /></Field>
            <UserPicker label={t("sites.siteHead")} value={f.siteHeadUserId ?? ""} valueName={headName || undefined} siteId={site.id} roleHint="site_head" onChange={(uid, u) => { setF({ ...f, siteHeadUserId: uid || null }); setHeadName(u?.name ?? ""); }} hint={f.siteHeadUserId && !headName ? t("sites.siteHeadSet") : undefined} />
          </div>
          <Toggle label={t("sites.hazardous")} hint={t("sites.hazardousHint")} checked={f.hazardousProcess} onChange={(v) => setF({ ...f, hazardousProcess: v })} disabled={readOnly} />
        </Card>
        <div className="stack">
          <Card>
            <CardHead title={t("sites.location")} />
            <div className="form-grid">
              <Field label={t("sites.lat")}><Input type="number" step="any" value={f.lat ?? ""} onChange={(e) => setF({ ...f, lat: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} /></Field>
              <Field label={t("sites.lng")}><Input type="number" step="any" value={f.lng ?? ""} onChange={(e) => setF({ ...f, lng: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} /></Field>
              <Field label={t("sites.geofence")} hint={t("sites.geofenceHint")}><Input type="number" min={50} max={5000} value={f.geofenceRadiusM ?? ""} onChange={(e) => setF({ ...f, geofenceRadiusM: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} /></Field>
            </div>
            {f.lat !== null && f.lng !== null ? <a className="small" href={`https://www.openstreetmap.org/?mlat=${f.lat}&mlon=${f.lng}#map=16/${f.lat}/${f.lng}`} target="_blank" rel="noreferrer">{t("sites.openMap")} <IconExternal size={12} /></a> : null}
          </Card>
          <Card>
            <CardHead title={t("sites.rules")} kicker={t("status.tagHint")} />
            <Field label={t("sites.ruleSet")} hint={rs ? <span className="row" style={{ gap: 6 }}><StatusTag label={rs.status} />{!rs.enabled ? <Pill tone="red">{t("rules.disabled")}</Pill> : null}<span>{rs.name} · {rs.regime}</span></span> : t("sites.ruleSetHint")} error={ruleErr}>
              <Select value={f.ruleSetCode ?? ""} onChange={(e) => setF({ ...f, ruleSetCode: e.target.value || null })} disabled={readOnly}>
                <option value="">—</option>
                {(ruleSets.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}{!r.enabled ? ` (${t("rules.disabled")})` : ""}</option>)}
              </Select>
            </Field>
            <Field label={t("sites.effectiveFrom")} hint={t("sites.effectiveHint")}><Input type="date" value={f.ruleSetEffectiveFrom?.slice(0, 10) ?? ""} onChange={(e) => setF({ ...f, ruleSetEffectiveFrom: e.target.value || null })} disabled={readOnly} /></Field>
            <Field label={t("nav.riskMatrix")} hint={t("sites.matrixHint")}>
              <Select value={f.riskMatrixVersionId ?? ""} onChange={(e) => setF({ ...f, riskMatrixVersionId: e.target.value || null })} disabled={readOnly}>
                <option value="">{t("sites.matrixDefault")}</option>
                {matrices.data.filter((m) => m.status !== "draft").map((m) => <option key={m.id} value={m.id}>{m.name} v{m.version} · {t(`matrix.status.${m.status}`)} · {m.statusLabel}</option>)}
              </Select>
            </Field>
          </Card>
          <Card>
            <CardHead title={t("sites.calendar")} />
            <Field label={t("sites.weeklyOff")}>
              <ChipsSelect ariaLabel={t("sites.weeklyOff")} options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(`day.${d}`) }))} value={f.workingCalendar.weeklyOff.map(String)} onChange={(v) => !readOnly && setF({ ...f, workingCalendar: { ...f.workingCalendar, weeklyOff: v.map(Number).sort() } })} />
            </Field>
            <div className="form-grid">
              <Field label={t("sites.shiftStart")}><Input type="time" value={f.workingCalendar.shiftStart} onChange={(e) => setF({ ...f, workingCalendar: { ...f.workingCalendar, shiftStart: e.target.value } })} disabled={readOnly} /></Field>
              <Field label={t("sites.shiftEnd")}><Input type="time" value={f.workingCalendar.shiftEnd} onChange={(e) => setF({ ...f, workingCalendar: { ...f.workingCalendar, shiftEnd: e.target.value } })} disabled={readOnly} /></Field>
            </div>
          </Card>
        </div>
      </div>
      {err ? <div className="error-card" role="alert" style={{ marginTop: 12 }}><p style={{ margin: 0 }}>{err}</p></div> : null}
      {!readOnly ? (
        <div className="sticky-foot">
          <span className="small muted" style={{ alignSelf: "center", marginRight: "auto" }}>{t("sites.version", { v: site.version, at: fmtDate(site.updatedAt, lang) })}</span>
          {site.active ? <Button variant="danger" onClick={() => setDel(true)}><IconTrash size={16} />{t("sites.deactivate")}</Button> : null}
          <Button type="submit" variant="primary" loading={busy}>{t("common.save")}</Button>
        </div>
      ) : null}
      {del ? <ReasonSheet danger title={t("sites.deactivate")} body={t("sites.deactivateBody")} confirmLabel={t("sites.deactivate")} onClose={() => setDel(false)} onConfirm={async (reason) => { await api.del(`/admin/sites/${site.id}`, { reason }); await reloadSites(); toast.success(t("sites.deactivated")); nav("/sites"); }} /> : null}
    </Form>
  );
}

/* ------------------------------------------------------------------ areas */
function AreasTab({ siteId }: { siteId: string }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { loadAreas, areasFor, searchUsers } = useScope();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [edit, setEdit] = useState<Partial<Area> | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const areas = areasFor(siteId).filter((a) => !hidden.has(a.id));
  const refresh = () => { setLoading(true); setErr(null); loadAreas(siteId, true).catch(setErr).finally(() => setLoading(false)); };
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId]);
  const canEdit = perms.canSiteConfig(siteId) && !perms.readOnly;
  const children = (parent: string | null) => areas.filter((a) => a.parentAreaId === parent).sort((a, b) => a.sort - b.sort);
  const onDrop = async (e: DragEvent, target: Area) => {
    e.preventDefault(); setOverId(null);
    const src = areas.find((a) => a.id === dragId); setDragId(null);
    if (!src || src.id === target.id || src.parentAreaId !== target.parentAreaId) return;
    const sib = children(target.parentAreaId).filter((a) => a.id !== src.id);
    const idx = sib.findIndex((a) => a.id === target.id);
    sib.splice(idx, 0, src);
    try {
      await Promise.all(sib.map((a, i) => (a.sort !== i ? api.put(`/admin/areas/${a.id}`, { ...a, sort: i }) : Promise.resolve())));
      await loadAreas(siteId, true);
    } catch (er) { toast.error(errMessage(er)); }
  };
  const remove = (a: Area) => {
    setHidden((h) => new Set(h).add(a.id));
    toast.undoable(t("areas.removed", { name: pick(a.name) }), async () => { try { await api.del(`/admin/areas/${a.id}`); await loadAreas(siteId, true); } catch (er) { toast.error(errMessage(er)); } setHidden((h) => { const n = new Set(h); n.delete(a.id); return n; }); }, () => setHidden((h) => { const n = new Set(h); n.delete(a.id); return n; }));
  };
  const Node = ({ a, depth }: { a: Area; depth: number }) => (
    <li>
      <div className={`node${overId === a.id ? " drag-over" : ""}`} draggable={canEdit} onDragStart={() => setDragId(a.id)} onDragOver={(e) => { e.preventDefault(); setOverId(a.id); }} onDragLeave={() => setOverId(null)} onDrop={(e) => onDrop(e, a)}>
        {canEdit ? <span className="grip" aria-hidden><IconMenu size={16} /></span> : null}
        <span className="nm">{pick(a.name)}</span><span className="code">{a.code}</span>
        <Pill>{t(`area.${a.areaType}`)}</Pill>
        {a.hazardousProcess ? <Pill tone="orange">{t("sites.hazardous")}</Pill> : null}
        {!a.active ? <Pill tone="grey">{t("sites.inactive")}</Pill> : null}
        <span className="sp" />
        {canEdit ? <><Button size="sm" variant="ghost" icon onClick={() => setEdit(a)} aria-label={t("common.edit")}><IconEdit size={14} /></Button><Button size="sm" variant="ghost" icon onClick={() => remove(a)} aria-label={t("common.remove")}><IconTrash size={14} /></Button></> : null}
      </div>
      {children(a.id).length && depth < 4 ? <ul>{children(a.id).map((c) => <Node key={c.id} a={c} depth={depth + 1} />)}</ul> : null}
    </li>
  );
  return (
    <div className="stack">
      <div className="row between">
        <span className="small muted">{t("areas.count", { count: areas.length })} · {t("areas.dragHint")}</span>
        {canEdit ? <span className="btn-group"><Button size="sm" onClick={() => setImporting(true)}>{t("csv.importCsv")}</Button><Button size="sm" variant="primary" onClick={() => setEdit({ siteId, parentAreaId: null, code: "", name: { en: "" }, areaType: "other", hazardousProcess: false, ownerUserId: null })}><IconPlus size={14} />{t("areas.add")}</Button></span> : null}
      </div>
      {err ? <ErrorCard error={err} onRetry={refresh} /> : null}
      {loading && areas.length === 0 ? <Skeleton lines={5} /> : null}
      {!loading && areas.length === 0 && !err ? <EmptyState title={t("areas.empty")} body={t("areas.emptyHint")} action={canEdit ? <Button variant="primary" size="sm" onClick={() => setEdit({ siteId, parentAreaId: null, code: "", name: { en: "" }, areaType: "other", hazardousProcess: false, ownerUserId: null })}>{t("areas.add")}</Button> : undefined} /> : null}
      {areas.length ? <ul className="tree">{children(null).map((a) => <Node key={a.id} a={a} depth={0} />)}</ul> : null}
      {edit ? <AreaSheet area={edit} siteId={siteId} all={areas} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} searchUsers={searchUsers} /> : null}
      {importing ? (
        <Sheet title={t("areas.importTitle")} onClose={() => setImporting(false)} wide>
          <CsvImport columns={[{ key: "code", label: t("sites.code"), required: true }, { key: "name", label: t("sites.name"), required: true }, { key: "type", label: t("areas.type"), options: AREA_TYPES }, { key: "parent", label: t("areas.parent") }]}
            sample={"code,name,type,parent\nGATE,Main gate,gate,\nBLKA,Block A,production,\nBLKA-L1,Level 1,production,BLKA"} onImport={(csv) => api.post<ImportResult>(`/admin/sites/${siteId}/areas/import`, { csv })} onDone={() => { setImporting(false); refresh(); }} />
        </Sheet>
      ) : null}
    </div>
  );
}

function AreaSheet({ area, siteId, all, onClose, onSaved, searchUsers }: { area: Partial<Area>; siteId: string; all: Area[]; onClose: () => void; onSaved: () => void; searchUsers: ReturnType<typeof useScope>["searchUsers"] }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const [f, setF] = useState<Partial<Area>>(area);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ownerName, setOwnerName] = useState("");
  useEffect(() => { if (area.ownerUserId) searchUsers("", siteId).then((u) => setOwnerName(u.find((x) => x.id === area.ownerUserId)?.name ?? "")).catch(() => undefined); }, [area.ownerUserId, siteId, searchUsers]);
  const valid = !!f.code?.trim() && !!f.name?.en?.trim();
  return (
    <Sheet title={area.id ? t("areas.edit") : t("areas.add")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!valid} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try { if (area.id) await api.put(`/admin/areas/${area.id}`, f); else await api.post(`/admin/sites/${siteId}/areas`, f); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>{t("common.save")}</Button></>}>
      <I18nInput label={t("sites.name")} required value={f.name} onChange={(v) => setF({ ...f, name: v })} />
      <div className="form-grid">
        <Field label={t("sites.code")} required><Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={12} /></Field>
        <Field label={t("areas.type")}><Select value={f.areaType} onChange={(e) => setF({ ...f, areaType: e.target.value as AreaType })}>{AREA_TYPES.map((x) => <option key={x} value={x}>{t(`area.${x}`)}</option>)}</Select></Field>
        <Field label={t("areas.parent")}><Select value={f.parentAreaId ?? ""} onChange={(e) => setF({ ...f, parentAreaId: e.target.value || null })}><option value="">{t("areas.topLevel")}</option>{all.filter((a) => a.id !== area.id).map((a) => <option key={a.id} value={a.id}>{pick(a.name)} ({a.code})</option>)}</Select></Field>
        <UserPicker label={t("areas.owner")} value={f.ownerUserId ?? ""} valueName={ownerName || undefined} siteId={siteId} onChange={(id, u) => { setF({ ...f, ownerUserId: id || null }); setOwnerName(u?.name ?? ""); }} />
      </div>
      <Toggle label={t("sites.hazardous")} checked={!!f.hazardousProcess} onChange={(v) => setF({ ...f, hazardousProcess: v })} />
      {area.id ? <Toggle label={t("sites.active")} checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} /> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
