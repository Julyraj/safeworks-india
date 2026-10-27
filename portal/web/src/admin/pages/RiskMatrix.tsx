/* Risk matrix: active version with the kit's RiskMatrix, draft editor (labels, anchors, bands with ranges / colours / responses in 4 languages),
   activate (server enforces approver ≠ author; its message is shown), assign a version to sites. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { Band, I18n, RiskMatrixVersion } from "../../shared/types";
import { Button, Card, CardHead, Confirm, EmptyState, ErrorCard, Field, Input, Pill, RiskMatrix, Select, Sheet, Skeleton, Tabs, useToast } from "../../shared/ui";
import { fmtDate } from "../../shared/format";
import { IconPlus, IconCheck } from "../../shared/icons";
import { api, errMessage } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { ChipsSelect, I18nInput, PageHead, StatusTag, AsyncButton } from "../components";

const BANDS: Band[] = ["low", "moderate", "high", "extreme"];
const COLOURS: RiskMatrixVersion["bands"][number]["colour"][] = ["green", "amber", "orange", "red"];

export default function RiskMatrixPage() {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { matrices, reload, sites, reloadSites } = useScope();
  const [sel, setSel] = useState<string>("");
  const [assign, setAssign] = useState<RiskMatrixVersion | null>(null);
  const [activate, setActivate] = useState<RiskMatrixVersion | null>(null);
  const [actErr, setActErr] = useState("");
  const versions = [...matrices.data].sort((a, b) => b.version - a.version);
  const active = versions.find((v) => v.status === "active") ?? null;
  const cur = versions.find((v) => v.id === sel) ?? active ?? versions[0] ?? null;
  const canEdit = perms.isHse && !perms.readOnly;
  useEffect(() => { if (!sel && active) setSel(active.id); }, [active, sel]);
  const newDraft = async () => {
    const base = active ?? cur;
    if (!base) return;
    try { const d = await api.post<RiskMatrixVersion>(`/admin/risk-matrices/${base.matrixId}/versions`); await reload("matrices"); setSel(d.id); toast.success(t("matrix.draftCreated", { v: d.version })); } catch (e) { toast.error(errMessage(e)); }
  };
  return (
    <>
      <PageHead title={t("nav.riskMatrix")} sub={t("matrix.sub")} tools={canEdit ? <Button variant="primary" onClick={newDraft} disabled={!cur}><IconPlus size={16} />{t("matrix.newDraft")}</Button> : null} />
      {matrices.error ? <ErrorCard error={matrices.error} onRetry={() => reload("matrices")} /> : null}
      {!matrices.loaded ? <Skeleton lines={8} /> : null}
      {matrices.loaded && versions.length === 0 ? <EmptyState title={t("matrix.empty")} body={t("matrix.emptyHint")} /> : null}
      {versions.length ? (
        <>
          <Tabs value={cur?.id ?? ""} onChange={setSel} tabs={versions.map((v) => ({ value: v.id, label: <span className="row nowrap" style={{ gap: 6 }}>{v.name} v{v.version}<Pill tone={v.status === "active" ? "green" : v.status === "draft" ? "amber" : "grey"}>{t(`matrix.status.${v.status}`)}</Pill></span> }))} />
          {cur ? (
            <div className="two-col" style={{ marginTop: 14 }}>
              <Card>
                <CardHead title={`${cur.name} · v${cur.version}`} kicker={<span className="row" style={{ gap: 6 }}><StatusTag label={cur.statusLabel} />{cur.effectiveFrom ? <span>{t("sites.effectiveFrom")} {fmtDate(cur.effectiveFrom, lang)}</span> : null}</span>}
                  action={<div className="btn-group">
                    {canEdit && cur.status === "draft" ? <Button size="sm" variant="primary" onClick={() => { setActErr(""); setActivate(cur); }}><IconCheck size={14} />{t("matrix.activate")}</Button> : null}
                    {canEdit && cur.status !== "draft" ? <Button size="sm" onClick={() => setAssign(cur)}>{t("matrix.assign")}</Button> : null}
                  </div>} />
                <RiskMatrix matrix={cur} likelihood={null} severity={null} readOnly />
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="table"><thead><tr><th>{t("common.risk")}</th><th>{t("matrix.range")}</th><th>{t("matrix.response")}</th></tr></thead>
                    <tbody>{cur.bands.map((b) => <tr key={b.band}><td><span className={`band-chip band-${b.band}`}><span className="band-swatch" style={{ background: "currentColor" }} /> {t(`band.${b.band}`)}</span></td><td className="num">{b.min}–{b.max}</td><td>{pick(b.response)}</td></tr>)}</tbody></table>
                </div>
                <p className="small muted" style={{ marginTop: 8 }}>{t("matrix.sitesUsing", { n: sites.filter((s) => s.riskMatrixVersionId === cur.id).length, codes: sites.filter((s) => s.riskMatrixVersionId === cur.id).map((s) => s.code).join(", ") || "—" })}</p>
                {actErr ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{actErr}</p></div> : null}
              </Card>
              {cur.status === "draft" && canEdit ? <DraftEditor v={cur} onSaved={() => reload("matrices")} /> : (
                <Card>
                  <CardHead title={t("matrix.labels")} />
                  <div className="two-col">
                    <div><div className="label">{t("matrix.likelihood")}</div><ol style={{ paddingLeft: 18, margin: "4px 0" }}>{cur.likelihoodLabels.map((l) => <li key={l.v}>{pick(l.label)}</li>)}</ol></div>
                    <div><div className="label">{t("matrix.severity")}</div><ol style={{ paddingLeft: 18, margin: "4px 0" }}>{cur.severityLabels.map((s) => <li key={s.v}>{pick(s.label)}{s.anchor ? <span className="small muted"> — {pick(s.anchor)}</span> : null}</li>)}</ol></div>
                  </div>
                  <p className="small muted">{t("matrix.readOnlyHint")}</p>
                </Card>
              )}
            </div>
          ) : null}
        </>
      ) : null}
      {activate ? <Confirm title={t("matrix.activateTitle", { v: activate.version })} body={t("matrix.activateBody")} confirmLabel={t("matrix.activate")} onClose={() => setActivate(null)}
        onConfirm={async () => { try { await api.post(`/admin/risk-matrix-versions/${activate.id}/activate`); await reload("matrices"); toast.success(t("matrix.activated")); setActivate(null); } catch (e) { setActErr(errMessage(e)); setActivate(null); } }} /> : null}
      {assign ? <AssignSheet v={assign} onClose={() => setAssign(null)} onDone={async () => { setAssign(null); await reloadSites(); }} /> : null}
    </>
  );
}

function DraftEditor({ v, onSaved }: { v: RiskMatrixVersion; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState<RiskMatrixVersion>(v);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setF(v), [v]);
  const resize = (n: 3 | 4 | 5) => setF({ ...f, size: n, likelihoodLabels: Array.from({ length: n }, (_, i) => f.likelihoodLabels[i] ?? { v: i + 1, label: { en: "" } }), severityLabels: Array.from({ length: n }, (_, i) => f.severityLabels[i] ?? { v: i + 1, label: { en: "" } }) });
  const problems: string[] = [];
  const max = f.size * f.size;
  f.bands.forEach((b, i) => { if (b.min > b.max) problems.push(t("matrix.err.range", { band: t(`band.${b.band}`) })); if (i > 0 && b.min <= f.bands[i - 1].max) problems.push(t("matrix.err.overlap", { band: t(`band.${b.band}`) })); });
  if (f.bands.length && f.bands[f.bands.length - 1].max < max) problems.push(t("matrix.err.cover", { max }));
  return (
    <Card>
      <CardHead title={t("matrix.editDraft")} kicker={t("matrix.editDraftKicker")} />
      <div className="form-grid">
        <Field label={t("matrix.name")} required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} /></Field>
        <Field label={t("matrix.size")}><Select value={f.size} onChange={(e) => resize(Number(e.target.value) as 3 | 4 | 5)}><option value={3}>3×3</option><option value={4}>4×4</option><option value={5}>5×5</option></Select></Field>
        <Field label={t("status.label")} hint={t("status.tagHint")}><Input value={f.statusLabel} onChange={(e) => setF({ ...f, statusLabel: e.target.value })} maxLength={80} /></Field>
        <Field label={t("sites.effectiveFrom")}><Input type="date" value={f.effectiveFrom?.slice(0, 10) ?? ""} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value || null })} /></Field>
      </div>
      <div className="section-title">{t("matrix.likelihood")}</div>
      {f.likelihoodLabels.map((l, i) => <I18nInput key={l.v} label={`${l.v}`} value={l.label} onChange={(val) => setF({ ...f, likelihoodLabels: f.likelihoodLabels.map((x, j) => (j === i ? { ...x, label: val } : x)) })} />)}
      <div className="section-title">{t("matrix.severity")}</div>
      {f.severityLabels.map((s, i) => (
        <div key={s.v}>
          <I18nInput label={`${s.v}`} value={s.label} onChange={(val) => setF({ ...f, severityLabels: f.severityLabels.map((x, j) => (j === i ? { ...x, label: val } : x)) })} />
          <I18nInput label={t("matrix.anchor", { v: s.v })} value={s.anchor ?? { en: "" }} onChange={(val: I18n) => setF({ ...f, severityLabels: f.severityLabels.map((x, j) => (j === i ? { ...x, anchor: val } : x)) })} />
        </div>
      ))}
      <div className="section-title">{t("matrix.bands")}</div>
      {f.bands.map((b, i) => (
        <div key={b.band}>
          <div className="band-editor">
            <span className={`band-chip band-${b.band}`}>{t(`band.${b.band}`)}</span>
            <Input type="number" min={1} max={max} value={b.min} onChange={(e) => setF({ ...f, bands: f.bands.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })} aria-label={t("matrix.min")} />
            <Input type="number" min={1} max={max} value={b.max} onChange={(e) => setF({ ...f, bands: f.bands.map((x, j) => (j === i ? { ...x, max: Number(e.target.value) } : x)) })} aria-label={t("matrix.max")} />
            <Select value={b.colour} onChange={(e) => setF({ ...f, bands: f.bands.map((x, j) => (j === i ? { ...x, colour: e.target.value as typeof b.colour } : x)) })} aria-label={t("matrix.colour")}>{COLOURS.map((c) => <option key={c} value={c}>{t(`colour.${c}`)}</option>)}</Select>
            <span className="small muted">{t("matrix.scoreRange", { min: b.min, max: b.max })}</span>
          </div>
          <I18nInput label={t("matrix.responseFor", { band: t(`band.${b.band}`) })} textarea value={b.response} onChange={(val) => setF({ ...f, bands: f.bands.map((x, j) => (j === i ? { ...x, response: val } : x)) })} />
        </div>
      ))}
      {f.bands.length < 4 ? <Button size="sm" onClick={() => setF({ ...f, bands: [...f.bands, { band: BANDS[f.bands.length], min: (f.bands[f.bands.length - 1]?.max ?? 0) + 1, max, colour: COLOURS[f.bands.length], response: { en: "" } }] })}><IconPlus size={14} />{t("matrix.addBand")}</Button> : null}
      {problems.length ? <div className="field invalid" style={{ marginTop: 8 }}>{problems.map((p, i) => <div className="error" key={i}>{p}</div>)}</div> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
      <div className="sticky-foot">
        <Button variant="primary" loading={busy} disabled={problems.length > 0 || !f.name.trim()} onClick={async () => { setBusy(true); setErr(""); try { await api.put(`/admin/risk-matrix-versions/${v.id}`, f); toast.success(t("common.saved")); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("matrix.saveDraft")}</Button>
      </div>
    </Card>
  );
}

function AssignSheet({ v, onClose, onDone }: { v: RiskMatrixVersion; onClose: () => void; onDone: () => Promise<void> }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { sites } = useScope();
  const [ids, setIds] = useState<string[]>(sites.filter((s) => s.riskMatrixVersionId === v.id).map((s) => s.id));
  return (
    <Sheet title={t("matrix.assignTitle", { name: `${v.name} v${v.version}` })} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><AsyncButton variant="primary" onClick={async () => { await Promise.all(sites.filter((s) => ids.includes(s.id) && s.riskMatrixVersionId !== v.id).map((s) => api.post(`/admin/sites/${s.id}/risk-matrix`, { versionId: v.id }))); toast.success(t("matrix.assigned")); await onDone(); }}>{t("matrix.assign")}</AsyncButton></>}>
      <p className="small muted">{t("matrix.assignBody")}</p>
      <ChipsSelect ariaLabel={t("nav.sites")} options={sites.map((s) => ({ value: s.id, label: `${s.code} · ${pick(s.name)}` }))} value={ids} onChange={setIds} />
    </Sheet>
  );
}
