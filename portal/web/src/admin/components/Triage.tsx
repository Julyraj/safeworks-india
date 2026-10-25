/* Triage from the console: the same TriageRequest the field app sends. Matrix from the site's active version, IS 3786 pre-set
   from the type, employer, action builder with owner suggestions and due dates from the band rule, interim control for Extreme. */
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../shared/i18n";
import type { ActionDraft, ActionType, Band, ControlLevel, DuplicateSuggestion, ObservationDetail, TriageDecision, TriageRequest } from "../../shared/types";
import { Button, Chip, ChipBar, Field, Input, RiskMatrix, Select, Sheet, Textarea, Pill, BandPill, useToast } from "../../shared/ui";
import { IconPlus, IconTrash } from "../../shared/icons";
import { bandFor, dueFromRule, is3786Default, ruleFor } from "../../shared/risk";
import { uuid } from "../../shared/storage";
import { fmtDateTime } from "../../shared/format";
import { api, asList, datetimeLocalValue, errMessage, fromDatetimeLocal } from "../api";
import { useDueRules, useScope } from "../scope";
import { UserPicker } from "./index";

const DECISIONS: TriageDecision[] = ["accept_assign", "accept_fixed_on_spot", "return_to_reporter", "reviewed_no_action", "merge_duplicate", "discard", "escalate_incident"];
const REASON_CODES = ["not_a_hazard", "already_controlled", "insufficient_info", "out_of_scope", "duplicate", "test_entry", "other"];
const ACTION_TYPES: ActionType[] = ["correction", "corrective", "preventive", "improvement"];
const CONTROLS: ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];

export interface DraftRow extends ActionDraft { ownerName: string }

export function newDraft(band: Band | undefined, dueAt: string | undefined, title = ""): DraftRow {
  return { clientUuid: uuid(), title, problem: "", actionType: "corrective", controlLevel: "engineering", ownerUserId: "", ownerName: "", responsibleEmployerId: null, band, dueAt, interimControl: "", interimReviewAt: "" };
}

/** One action draft (used by triage and by the inspection builder's action defaults preview). */
export function ActionDraftEditor({ draft, onChange, onRemove, siteId, defaultBand, employerId, errors }: { draft: DraftRow; onChange: (d: DraftRow) => void; onRemove?: () => void; siteId: string; defaultBand: Band | null; employerId: string | null | undefined; errors?: Partial<Record<keyof DraftRow, string>> }) {
  const { t } = useI18n();
  const { contractors, sites } = useScope();
  const rules = useDueRules();
  const band = draft.band ?? defaultBand ?? "moderate";
  const rule = ruleFor(rules, band, siteId);
  const needsInterim = rule.interimControlRequired;
  const site = sites.find((s) => s.id === siteId);
  const recompute = (b: Band) => fromDatetimeLocal(datetimeLocalValue(dueFromRule(ruleFor(rules, b, siteId), new Date(), site?.workingCalendar.weeklyOff).toISOString()));
  return (
    <div className="action-draft">
      <div className="row between" style={{ marginBottom: 6 }}>
        <strong>{t("triage.action")}</strong>
        <span className="row"><BandPill band={band} /><span className="small muted">{t("triage.dueRule", { n: rule.dueAmount, unit: t(`due.unit.${rule.dueUnit}`) })}</span>{onRemove ? <Button size="sm" variant="ghost" icon onClick={onRemove} aria-label={t("common.remove")}><IconTrash size={16} /></Button> : null}</span>
      </div>
      <Field label={t("triage.actionTitle")} required error={errors?.title}>
        <Input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} maxLength={160} placeholder={t("triage.actionTitlePh")} />
      </Field>
      <Field label={t("triage.problem")} optional>
        <Textarea rows={2} value={draft.problem ?? ""} onChange={(e) => onChange({ ...draft, problem: e.target.value })} maxLength={500} />
      </Field>
      <div className="form-grid">
        <Field label={t("triage.actionType")}><Select value={draft.actionType} onChange={(e) => onChange({ ...draft, actionType: e.target.value as ActionType })}>{ACTION_TYPES.map((a) => <option key={a} value={a}>{t(`action.type.${a}`)}</option>)}</Select></Field>
        <Field label={t("triage.controlLevel")} hint={t("triage.controlHint")}><Select value={draft.controlLevel} onChange={(e) => onChange({ ...draft, controlLevel: e.target.value as ControlLevel })}>{CONTROLS.map((c) => <option key={c} value={c}>{t(`control.${c}`)}</option>)}</Select></Field>
        <UserPicker label={t("common.owner")} required value={draft.ownerUserId} valueName={draft.ownerName} siteId={siteId} roleHint="action_owner" error={errors?.ownerUserId}
          onChange={(id, u) => onChange({ ...draft, ownerUserId: id, ownerName: u?.name ?? draft.ownerName, responsibleEmployerId: draft.responsibleEmployerId ?? u?.employerId ?? null })} />
        <Field label={t("triage.responsibleEmployer")}>
          <Select value={draft.responsibleEmployerId ?? employerId ?? ""} onChange={(e) => onChange({ ...draft, responsibleEmployerId: e.target.value || null })}>
            <option value="">{t("common.ownCompany")}</option>
            {contractors.data.filter((c) => !c.isOwnCompany).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t("common.risk")}><Select value={band} onChange={(e) => { const b = e.target.value as Band; onChange({ ...draft, band: b, dueAt: recompute(b) }); }}>{(["low", "moderate", "high", "extreme"] as Band[]).map((b) => <option key={b} value={b}>{t(`band.${b}`)}</option>)}</Select></Field>
        <Field label={t("common.dueDate")} required hint={t("triage.dueHint")} error={errors?.dueAt}><Input type="datetime-local" value={datetimeLocalValue(draft.dueAt)} onChange={(e) => onChange({ ...draft, dueAt: fromDatetimeLocal(e.target.value) })} /></Field>
      </div>
      {needsInterim ? (
        <div className="form-grid">
          <Field label={t("triage.interimControl")} required hint={t("triage.interimHint")} error={errors?.interimControl}><Textarea rows={2} value={draft.interimControl ?? ""} onChange={(e) => onChange({ ...draft, interimControl: e.target.value })} maxLength={300} /></Field>
          <Field label={t("triage.interimReview")} required error={errors?.interimReviewAt}><Input type="datetime-local" value={datetimeLocalValue(draft.interimReviewAt)} onChange={(e) => onChange({ ...draft, interimReviewAt: fromDatetimeLocal(e.target.value) })} /></Field>
        </div>
      ) : null}
    </div>
  );
}

export function TriageSheet({ obs, onClose, onDone }: { obs: ObservationDetail; onClose: () => void; onDone: (d: ObservationDetail) => void }) {
  const { t, pick, lang } = useI18n();
  const toast = useToast();
  const { categories, contractors, activeMatrix, sites } = useScope();
  const rules = useDueRules();
  const matrix = activeMatrix(obs.siteId);
  const site = sites.find((s) => s.id === obs.siteId);
  const [decision, setDecision] = useState<TriageDecision>(obs.imminentDanger ? "accept_assign" : "accept_assign");
  const [cats, setCats] = useState<string[]>(obs.categoryCodes);
  const [l, setL] = useState<number | null>(obs.likelihood);
  const [s, setS] = useState<number | null>(obs.severity);
  const [is3786, setIs] = useState<TriageRequest["is3786Code"]>((obs.is3786Code as TriageRequest["is3786Code"]) || is3786Default(obs.type));
  const [employer, setEmployer] = useState<string>(obs.employerInvolvedId ?? "");
  const [trade, setTrade] = useState(obs.trade ?? "");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [question, setQuestion] = useState("");
  const [master, setMaster] = useState("");
  const [masterQ, setMasterQ] = useState("");
  const [masterHits, setMasterHits] = useState<DuplicateSuggestion[]>(obs.duplicates ?? []);
  const [interim, setInterim] = useState(obs.immediateAction && obs.fixedOnSpot ? "" : "");
  const [learnedAt, setLearnedAt] = useState(new Date().toISOString());
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const { score, band } = bandFor(matrix, l, s);
  const extreme = band === "extreme" || obs.imminentDanger;
  const defaultDue = useMemo(() => (band ? dueFromRule(ruleFor(rules, band, obs.siteId), new Date(), site?.workingCalendar.weeklyOff).toISOString() : undefined), [band, rules, obs.siteId, site]);

  useEffect(() => {
    // first action draft appears with the first rating; its band and due date follow the matrix until edited
    if (decision === "accept_assign" && drafts.length === 0 && band) setDrafts([newDraft(band, defaultDue, obs.description.slice(0, 80))]);
  }, [band, decision, drafts.length, defaultDue, obs.description]);

  useEffect(() => {
    if (decision !== "merge_duplicate") return;
    const q = masterQ.trim();
    if (!q) { setMasterHits(obs.duplicates ?? []); return; }
    const id = setTimeout(() => {
      api.get("/observations", { siteId: obs.siteId, q, pageSize: 8 }).then((r) => {
        setMasterHits(asList<any>(r).filter((o) => o.id !== obs.id && !["closed", "discarded", "merged"].includes(o.status)).map((o) => ({ id: o.id, caseNo: o.caseNo, type: o.type, status: o.status, description: o.description, receivedAt: o.receivedAt, score: 0, reasons: [] })));
      }).catch(() => setMasterHits([]));
    }, 300);
    return () => clearTimeout(id);
  }, [masterQ, decision, obs]);

  const anonymousOrQr = obs.anonymous || obs.channel === "qr";
  const needsRating = decision === "accept_assign" || decision === "accept_fixed_on_spot" || decision === "escalate_incident";

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (needsRating) {
      if (cats.length === 0) fe.cats = t("triage.err.categories");
      if (!l || !s) fe.matrix = t("triage.err.matrix");
      if (decision !== "escalate_incident" && !is3786) fe.is3786 = t("triage.err.is3786");
    }
    if (decision === "accept_assign") {
      if (drafts.length === 0) fe.drafts = t("triage.err.oneAction");
      drafts.forEach((d, i) => {
        if (!d.title.trim()) fe[`d${i}.title`] = t("csv.required");
        if (!d.ownerUserId) fe[`d${i}.ownerUserId`] = t("triage.err.owner");
        if (!d.dueAt) fe[`d${i}.dueAt`] = t("csv.required");
        const r = ruleFor(rules, d.band ?? band ?? "moderate", obs.siteId);
        if (r.interimControlRequired && !(d.interimControl ?? "").trim()) fe[`d${i}.interimControl`] = t("triage.err.interim");
      });
      if (extreme && !interim.trim()) fe.interim = t("triage.err.interimExtreme");
    }
    if ((decision === "reviewed_no_action" || decision === "discard") && (!reasonCode || reasonText.trim().length < 3)) fe.reason = t("triage.err.reason");
    if (decision === "return_to_reporter") { if (anonymousOrQr) fe.question = t("triage.returnBlocked"); else if (question.trim().length < 3) fe.question = t("triage.err.question"); }
    if (decision === "merge_duplicate" && !master) fe.master = t("triage.err.master");
    if (decision === "escalate_incident" && !learnedAt) fe.learnedAt = t("csv.required");
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  };

  const submit = async () => {
    setErr("");
    if (!validate()) { setErr(t("error.validation")); return; }
    const body: TriageRequest = { clientUuid: uuid(), decision, capturedAt: new Date().toISOString() };
    if (needsRating) { body.categoryCodes = cats; body.likelihood = l!; body.severity = s!; body.is3786Code = is3786; body.employerInvolvedId = employer || null; body.trade = trade || undefined; }
    if (decision === "accept_assign") {
      body.actions = drafts.map(({ ownerName: _n, ...d }) => ({ ...d, band: d.band ?? band ?? undefined, responsibleEmployerId: d.responsibleEmployerId ?? (employer || null), interimControl: d.interimControl || undefined, interimReviewAt: d.interimReviewAt || undefined, problem: d.problem || undefined }));
      if (extreme) body.interimControl = interim.trim();
    }
    if (decision === "accept_fixed_on_spot") { body.reasonText = reasonText || undefined; }
    if (decision === "reviewed_no_action" || decision === "discard") { body.reasonCode = reasonCode; body.reasonText = reasonText.trim(); }
    if (decision === "return_to_reporter") body.question = question.trim();
    if (decision === "merge_duplicate") { body.masterObservationId = master; body.reasonText = reasonText || undefined; }
    if (decision === "escalate_incident") { body.learnedAt = learnedAt; body.reasonText = reasonText || undefined; }
    setBusy(true);
    try {
      const d = await api.post<ObservationDetail>(`/observations/${obs.id}/triage`, body);
      toast.success(t("triage.done", { decision: t(`triage.decision.${decision}`) }));
      onDone(d);
    } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet title={`${t("triage.title")} · ${obs.caseNo}`} onClose={onClose} wide footer={<>
      <Button onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant="primary" loading={busy} onClick={submit}>{t(`triage.submit.${decision}`)}</Button>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>{t("triage.decisionLabel")}</div>
          <ChipBar wrap>
            {DECISIONS.map((d) => <Chip key={d} on={decision === d} onClick={() => { setDecision(d); setFieldErr({}); setErr(""); }} disabled={d === "return_to_reporter" && anonymousOrQr} title={d === "return_to_reporter" && anonymousOrQr ? t("triage.returnBlocked") : undefined}>{t(`triage.decision.${d}`)}</Chip>)}
          </ChipBar>
          <p className="small muted" style={{ margin: "6px 0 0" }}>{t(`triage.decision.${decision}.hint`)}</p>
        </div>

        {obs.imminentDanger ? <div className="banner critical" role="alert">{t("triage.dangerNow")}</div> : null}

        {needsRating ? (
          <div className="two-col">
            <div>
              <Field label={t("common.categories")} required error={fieldErr.cats}>
                <ChipBar wrap>
                  {categories.data.filter((c) => c.active).map((c) => <Chip key={c.code} on={cats.includes(c.code)} onClick={() => { setCats((x) => (x.includes(c.code) ? x.filter((y) => y !== c.code) : [...x, c.code])); if (!is3786 && c.is3786Default) setIs(c.is3786Default as any); }}>{pick(c.name)}</Chip>)}
                </ChipBar>
              </Field>
              <div className="form-grid">
                <Field label={t("triage.is3786")} required={decision !== "escalate_incident"} hint={t("triage.is3786Hint")} error={fieldErr.is3786}>
                  <Select value={is3786 ?? ""} onChange={(e) => setIs(e.target.value as TriageRequest["is3786Code"])}>
                    <option value="">—</option><option value="B-2">B-2 · {t("triage.is3786.B2")}</option><option value="B-3">B-3 · {t("triage.is3786.B3")}</option><option value="B-4">B-4 · {t("triage.is3786.B4")}</option>
                  </Select>
                </Field>
                <Field label={t("triage.employerInvolved")} required hint={t("triage.employerHint")}>
                  <Select value={employer} onChange={(e) => setEmployer(e.target.value)}>
                    <option value="">{t("common.ownCompany")}</option>
                    {contractors.data.filter((c) => !c.isOwnCompany).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label={t("common.trade")} optional><Input value={trade} onChange={(e) => setTrade(e.target.value)} maxLength={60} /></Field>
              </div>
            </div>
            <div>
              <Field label={t("triage.rate")} required hint={`${matrix.name} · v${matrix.version}`} error={fieldErr.matrix}>
                <RiskMatrix matrix={matrix} likelihood={l} severity={s} onChange={(ll, ss) => { setL(ll); setS(ss); setDrafts((ds) => ds.map((d) => { const b = bandFor(matrix, ll, ss).band ?? d.band; return { ...d, band: b, dueAt: b ? dueFromRule(ruleFor(rules, b, obs.siteId), new Date(), site?.workingCalendar.weeklyOff).toISOString() : d.dueAt }; })); }} />
              </Field>
              {score ? <div className="small muted">{t("matrix.score", { score, band: band ? t(`band.${band}`) : "" })}</div> : null}
            </div>
          </div>
        ) : null}

        {decision === "accept_assign" ? (
          <div>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div className="label">{t("triage.actions")} <span className="muted small">({t("triage.atLeastOne")})</span></div>
              <Button size="sm" onClick={() => setDrafts((d) => [...d, newDraft(band ?? undefined, defaultDue)])}><IconPlus size={16} />{t("triage.addAction")}</Button>
            </div>
            {fieldErr.drafts ? <div className="field invalid"><div className="error">{fieldErr.drafts}</div></div> : null}
            {drafts.map((d, i) => (
              <ActionDraftEditor key={d.clientUuid} draft={d} siteId={obs.siteId} defaultBand={band} employerId={employer || null}
                errors={{ title: fieldErr[`d${i}.title`], ownerUserId: fieldErr[`d${i}.ownerUserId`], dueAt: fieldErr[`d${i}.dueAt`], interimControl: fieldErr[`d${i}.interimControl`] }}
                onChange={(nd) => setDrafts((ds) => ds.map((x) => (x.clientUuid === nd.clientUuid ? nd : x)))} onRemove={drafts.length > 1 ? () => setDrafts((ds) => ds.filter((x) => x.clientUuid !== d.clientUuid)) : undefined} />
            ))}
            {extreme ? (
              <Field label={t("triage.interimExtreme")} required hint={t("triage.interimExtremeHint")} error={fieldErr.interim}>
                <Textarea rows={2} value={interim} onChange={(e) => setInterim(e.target.value)} maxLength={300} />
              </Field>
            ) : null}
            {extreme ? <div className="banner warn">{t("triage.stopWorkNotice")}</div> : null}
          </div>
        ) : null}

        {decision === "accept_fixed_on_spot" ? (
          <Field label={t("triage.fixedNote")} optional hint={obs.immediateAction ? `${t("obs.immediateAction")}: ${obs.immediateAction}` : undefined}>
            <Textarea rows={2} value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={300} />
          </Field>
        ) : null}

        {decision === "return_to_reporter" ? (
          <Field label={t("triage.question")} required error={fieldErr.question} hint={anonymousOrQr ? t("triage.returnBlocked") : t("triage.questionHint")}>
            <Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} disabled={anonymousOrQr} />
          </Field>
        ) : null}

        {decision === "reviewed_no_action" || decision === "discard" ? (
          <div className="form-grid">
            <Field label={t("triage.reasonCode")} required error={fieldErr.reason}>
              <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                <option value="">—</option>
                {REASON_CODES.map((c) => <option key={c} value={c}>{t(`triage.reason.${c}`)}</option>)}
              </Select>
            </Field>
            <div className="full"><Field label={t("triage.reasonText")} required><Textarea rows={2} value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={300} /></Field></div>
          </div>
        ) : null}

        {decision === "merge_duplicate" ? (
          <div>
            <Field label={t("triage.master")} required hint={t("triage.masterHint")} error={fieldErr.master}>
              <Input value={masterQ} onChange={(e) => setMasterQ(e.target.value)} placeholder={t("triage.masterSearch")} />
            </Field>
            <div className="list-compact">
              {masterHits.map((h) => (
                <button key={h.id} type="button" className={`li${master === h.id ? " on" : ""}`} style={{ textAlign: "left", cursor: "pointer", borderColor: master === h.id ? "var(--ink)" : undefined }} onClick={() => setMaster(h.id)} aria-pressed={master === h.id}>
                  <span className="case">{h.caseNo}</span>
                  <span className="sp truncate">{h.description}</span>
                  <Pill>{t(`obs.status.${h.status}`)}</Pill>
                  {h.score ? <span className="small muted">{t("triage.dupScore", { score: Math.round(h.score * 100) })}</span> : null}
                  <span className="small muted">{fmtDateTime(h.receivedAt, lang)}</span>
                </button>
              ))}
              {masterHits.length === 0 ? <p className="small muted">{t("triage.noMaster")}</p> : null}
            </div>
          </div>
        ) : null}

        {decision === "escalate_incident" ? (
          <div className="form-grid">
            <Field label={t("triage.learnedAt")} required hint={t("triage.learnedAtHint")} error={fieldErr.learnedAt}><Input type="datetime-local" value={datetimeLocalValue(learnedAt)} onChange={(e) => setLearnedAt(fromDatetimeLocal(e.target.value))} /></Field>
            <Field label={t("common.note")} optional><Textarea rows={2} value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={300} /></Field>
            <div className="hint-box full">{t("triage.escalateNote")}</div>
          </div>
        ) : null}

        {err ? <div className="error-card" role="alert"><p style={{ margin: 0 }}>{err}</p></div> : null}
      </div>
    </Sheet>
  );
}
