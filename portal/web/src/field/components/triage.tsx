/* Triage sheet (brief §5.2): one sheet with the decision, the risk matrix, categories, IS 3786 code, employer and the
   inline action builder. Smart defaults: categories from the report, IS code from the type, employer from the report,
   owner = the area's owner or the last owner used for that category at the site, due date from the band rule.
   The result is a `triage` command so it works offline; a late decision on an already-triaged report comes back as a
   conflict and is kept as a comment by the server. */
import { useEffect, useMemo, useState } from "react";
import type { ActionDraft, ActionType, ControlLevel, DuplicateSuggestion, ObservationDetail, ObservationSummary, TriageDecision, TriageRequest } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Chip, ChipBar, Field, Input, RiskMatrix, Select, Sheet, Textarea, useToast, Pill } from "../../shared/ui";
import { IconPlus, IconTrash, IconMerge, IconAlert } from "../../shared/icons";
import { bandFor, dueFromRule, is3786Default, ruleFor, DEFAULT_MATRIX } from "../../shared/risk";
import { fmtDateTime, relative } from "../../shared/format";
import { uuid } from "../../shared/storage";
import { useSession } from "../session";
import { useActions, useObservations, useRefData } from "../offline/store";
import { triageObservation } from "../offline/commands";
import { UserSelect } from "./common";
import { assignable, categoriesFor, suggestOwner, obsTitle } from "../lib";

export const DISCARD_REASONS = ["not_a_hazard", "test_entry", "insufficient_info", "out_of_scope", "other"];
export const NO_ACTION_REASONS = ["already_controlled", "accepted_risk", "not_applicable", "resolved_elsewhere", "other"];
const ACTION_TYPES: ActionType[] = ["correction", "corrective", "preventive", "improvement"];
const CONTROLS: ControlLevel[] = ["elimination", "substitution", "engineering", "administrative", "ppe"];

type Draft = ActionDraft & { key: string };

export function TriageSheet({ obs, duplicates, onClose, onDone }: { obs: ObservationSummary & Partial<ObservationDetail>; duplicates?: DuplicateSuggestion[]; onClose: () => void; onDone: () => void }) {
  const { t, pick } = useI18n();
  const toast = useToast();
  const { me } = useSession();
  const ref = useRefData();
  const { data: actions } = useActions();
  const { data: observations } = useObservations();
  const site = ref.sites.find((s) => s.id === obs.siteId) ?? null;
  const matrix = ref.matrixVersions.find((m) => m.id === site?.riskMatrixVersionId) ?? ref.matrixVersions.find((m) => m.status === "active") ?? DEFAULT_MATRIX;
  const cats = useMemo(() => categoriesFor(ref, site, obs.type), [ref, site, obs.type]);
  const ownCompany = ref.contractors.find((c) => c.isOwnCompany);
  const contractors = ref.contractors.filter((c) => c.active && (c.isOwnCompany || c.siteIds.includes(obs.siteId)));
  const users = assignable(ref, obs.siteId);

  const [decision, setDecision] = useState<TriageDecision>(obs.fixedOnSpot ? "accept_fixed_on_spot" : "accept_assign");
  const [categoryCodes, setCategoryCodes] = useState<string[]>(obs.categoryCodes);
  const [likelihood, setLikelihood] = useState<number | null>(obs.likelihood ?? null);
  const [severity, setSeverity] = useState<number | null>(obs.severity ?? null);
  const [is3786, setIs3786] = useState<"B-2" | "B-3" | "B-4" | "">((obs.is3786Code as "B-2" | "B-3" | "" | undefined) || is3786Default(obs.type));
  const [employerId, setEmployerId] = useState<string>(obs.employerInvolvedId ?? ownCompany?.id ?? "");
  const [trade, setTrade] = useState(obs.trade ?? "");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [question, setQuestion] = useState("");
  const [masterId, setMasterId] = useState("");
  const [masterSearch, setMasterSearch] = useState("");
  const [interimControl, setInterimControl] = useState("");
  const [learnedAt, setLearnedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { band, score } = bandFor(matrix, likelihood, severity);
  const rule = band ? ruleFor(ref.dueDateRules, band, obs.siteId) : null;
  const needsInterim = band === "extreme" || obs.imminentDanger || (!!rule && rule.interimControlRequired && decision === "accept_assign");

  // one action pre-filled as soon as the band is known (accept_assign)
  const newDraft = (): Draft => {
    const cat = cats.find((c) => c.code === categoryCodes[0]);
    const b = band ?? "moderate";
    const r = ruleFor(ref.dueDateRules, b, obs.siteId);
    const owner = suggestOwner(ref, actions, observations, obs.siteId, obs.areaId, categoryCodes[0] ?? null) ?? me?.id ?? "";
    return {
      key: uuid(), clientUuid: uuid(), title: `${cat ? pick(cat.name) : t(`type.${obs.type}`)}: ${(obs.description || "").slice(0, 80)}`.trim().replace(/:\s*$/, ""), problem: obs.description,
      actionType: "corrective", controlLevel: obs.type === "unsafe_act" ? "administrative" : "engineering", ownerUserId: owner, responsibleEmployerId: employerId || null, band: b,
      dueAt: dueFromRule(r, new Date(), site?.workingCalendar.weeklyOff).toISOString(), interimControl: r.interimControlRequired ? "" : undefined,
      interimReviewAt: r.interimControlRequired ? new Date(Date.now() + (b === "extreme" ? 4 : 24) * 3_600_000).toISOString() : undefined,
    };
  };
  useEffect(() => {
    if (decision === "accept_assign" && drafts.length === 0 && band) setDrafts([newDraft()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision, band]);
  // keep due dates and band in step with the matrix choice until the officer edits them
  useEffect(() => {
    if (!band) return;
    setDrafts((ds) => ds.map((d) => {
      const r = ruleFor(ref.dueDateRules, band, obs.siteId);
      return { ...d, band, dueAt: dueFromRule(r, new Date(), site?.workingCalendar.weeklyOff).toISOString(), interimControl: r.interimControlRequired ? (d.interimControl ?? "") : d.interimControl };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band]);

  const masterCandidates = useMemo(() => {
    const local = observations.filter((o) => o.id !== obs.id && o.siteId === obs.siteId && !["closed", "discarded", "merged"].includes(o.status) && !o.local);
    const q = masterSearch.trim().toLowerCase();
    return (q ? local.filter((o) => `${o.caseNo} ${o.description}`.toLowerCase().includes(q)) : local.filter((o) => o.areaId === obs.areaId)).slice(0, 8);
  }, [observations, obs, masterSearch]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (decision === "accept_assign" || decision === "accept_fixed_on_spot" || decision === "escalate_incident") {
      if (categoryCodes.length === 0) e.categories = t("triage.needCategory");
      if (!likelihood || !severity) e.matrix = t("triage.needMatrix");
      if (!is3786 && decision !== "escalate_incident") e.is3786 = t("triage.needIs3786");
      if (!employerId) e.employer = t("triage.needEmployer");
    }
    if (decision === "accept_assign") {
      if (drafts.length === 0) e.actions = t("triage.needAction");
      drafts.forEach((d, i) => {
        if (!d.title.trim()) e[`a${i}.title`] = t("common.required");
        if (!d.ownerUserId) e[`a${i}.owner`] = t("triage.needOwner");
        if (d.interimControl !== undefined && !d.interimControl.trim() && (d.band === "high" || d.band === "extreme")) e[`a${i}.interim`] = t("triage.needInterimAction");
      });
      if (needsInterim && !interimControl.trim()) e.interim = t("triage.needInterim");
    }
    if (decision === "return_to_reporter") {
      if (obs.anonymous || obs.channel === "qr") e.decision = t("triage.noReturnAnonymous");
      if (!question.trim()) e.question = t("triage.needQuestion");
    }
    if (decision === "reviewed_no_action" || decision === "discard") {
      if (!reasonCode) e.reason = t("triage.needReason");
      if (reasonText.trim().length < 3) e.reasonText = t("triage.needReasonText");
    }
    if (decision === "merge_duplicate" && !masterId) e.master = t("triage.needMaster");
    if (decision === "escalate_incident" && !learnedAt) e.learnedAt = t("common.required");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) { toast.error(t("error.validation")); return; }
    setBusy(true);
    try {
      const req: TriageRequest = { clientUuid: uuid(), decision, capturedAt: new Date().toISOString() };
      if (decision === "accept_assign" || decision === "accept_fixed_on_spot" || decision === "escalate_incident") {
        Object.assign(req, { categoryCodes, likelihood: likelihood!, severity: severity!, is3786Code: is3786, employerInvolvedId: employerId || null, trade: trade || undefined });
      }
      if (decision === "accept_assign") { req.actions = drafts.map(({ key: _k, ...d }) => ({ ...d, interimControl: d.interimControl || undefined })); if (needsInterim) req.interimControl = interimControl.trim(); }
      if (decision === "return_to_reporter") req.question = question.trim();
      if (decision === "reviewed_no_action" || decision === "discard") { req.reasonCode = reasonCode; req.reasonText = reasonText.trim(); }
      if (decision === "merge_duplicate") req.masterObservationId = masterId;
      if (decision === "escalate_incident") req.learnedAt = new Date(learnedAt).toISOString();
      await triageObservation(obs.id, req, `${t(`triage.decision.${decision}`)} · ${obs.caseNo || obsTitle(obs, ref, t, pick)}`);
      toast.success(t("triage.saved"));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const decisions: { d: TriageDecision; danger?: boolean }[] = [
    { d: "accept_assign" }, { d: "accept_fixed_on_spot" }, { d: "return_to_reporter" }, { d: "reviewed_no_action" }, { d: "merge_duplicate" }, { d: "discard", danger: true }, { d: "escalate_incident", danger: true },
  ];
  const rates = decision === "accept_assign" || decision === "accept_fixed_on_spot" || decision === "escalate_incident";

  return (
    <Sheet title={t("triage.title")} onClose={onClose} wide footer={
      <>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant={decision === "discard" ? "danger" : "primary"} loading={busy} onClick={submit} data-testid="triage-submit">{decision === "accept_assign" ? t("triage.assign") : t(`triage.decision.${decision}`)}</Button>
      </>
    }>
      <p className="small muted" style={{ marginTop: 0 }}>{obs.caseNo} · {t(`type.${obs.type}`)} · {relative(obs.receivedAt, t)}{obs.imminentDanger ? <> · <Pill tone="red" dot>{t("report.dangerNow")}</Pill></> : null}</p>
      <div className="decision-grid" role="group" aria-label={t("triage.decision")}>
        {decisions.map(({ d, danger }) => (
          <button key={d} type="button" className={`decision-btn${danger ? " danger" : ""}`} aria-pressed={decision === d} onClick={() => setDecision(d)} data-testid={`decision-${d}`}>{t(`triage.decision.${d}`)}</button>
        ))}
      </div>
      {errors.decision ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600, marginTop: 6 }}>{errors.decision}</div> : null}

      {duplicates && duplicates.length > 0 && decision !== "merge_duplicate" ? (
        <div className="hint-box dup" style={{ marginTop: 12 }}>
          <IconMerge size={14} /> {t("triage.dupHint", { count: duplicates.length })} <button type="button" className="btn ghost sm" onClick={() => setDecision("merge_duplicate")}>{t("triage.decision.merge_duplicate")}</button>
        </div>
      ) : null}

      {rates ? (
        <div style={{ marginTop: 14 }}>
          <Field label={t("common.categories")} required error={errors.categories}>
            <ChipBar wrap>
              {cats.map((c) => <Chip key={c.code} on={categoryCodes.includes(c.code)} onClick={() => setCategoryCodes((cc) => (cc.includes(c.code) ? cc.filter((x) => x !== c.code) : [...cc, c.code]))}>{pick(c.name)}</Chip>)}
            </ChipBar>
          </Field>
          <Field label={t("common.risk")} required error={errors.matrix} hint={matrix.statusLabel ? `${matrix.name} · ${matrix.statusLabel}` : matrix.name}>
            <RiskMatrix matrix={matrix} likelihood={likelihood} severity={severity} onChange={(l, s) => { setLikelihood(l); setSeverity(s); }} />
          </Field>
          {band === "extreme" || obs.imminentDanger ? <div className="banner critical" style={{ marginBottom: 12 }}><IconAlert size={18} /><span>{t("triage.stopWork")}</span></div> : null}
          <div className="row" style={{ alignItems: "flex-start" }}>
            <Field label={t("triage.is3786")} required={decision !== "escalate_incident"} error={errors.is3786}>
              <Select value={is3786} onChange={(e) => setIs3786(e.target.value as "B-2" | "B-3" | "B-4" | "")} style={{ width: "auto" }}>
                <option value="">{t("common.choose")}</option>
                <option value="B-2">B-2 · {t("triage.is3786.B-2")}</option>
                <option value="B-3">B-3 · {t("triage.is3786.B-3")}</option>
                <option value="B-4">B-4 · {t("triage.is3786.B-4")}</option>
              </Select>
            </Field>
            <Field label={t("triage.employerInvolved")} required error={errors.employer}>
              <Select value={employerId} onChange={(e) => setEmployerId(e.target.value)} style={{ width: "auto" }}>
                <option value="">{t("common.choose")}</option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isOwnCompany ? ` (${t("common.ownCompany")})` : ""}</option>)}
              </Select>
            </Field>
            <Field label={t("common.trade")} optional><Input value={trade} onChange={(e) => setTrade(e.target.value)} style={{ width: 160 }} /></Field>
          </div>
        </div>
      ) : null}

      {decision === "accept_assign" ? (
        <div style={{ marginTop: 6 }}>
          {needsInterim ? (
            <Field label={t("triage.interimControl")} required error={errors.interim} hint={t("triage.interimHint")}>
              <Textarea rows={2} value={interimControl} onChange={(e) => setInterimControl(e.target.value)} maxLength={300} />
            </Field>
          ) : null}
          <div className="row between"><div className="label">{t("common.actions")} ({drafts.length})</div><Button size="sm" onClick={() => setDrafts((ds) => [...ds, newDraft()])} disabled={!band}><IconPlus size={16} /> {t("triage.addAction")}</Button></div>
          {errors.actions ? <div className="small" role="alert" style={{ color: "var(--red)", fontWeight: 600 }}>{errors.actions}</div> : null}
          {!band ? <p className="small muted">{t("triage.pickMatrixFirst")}</p> : null}
          <div className="stack" style={{ marginTop: 8 }}>
            {drafts.map((d, i) => (
              <div key={d.key} className="action-draft" data-testid="action-draft">
                <div className="row between">
                  <span className="defaults-note">{t("triage.defaultsFrom")}</span>
                  {drafts.length > 1 ? <Button size="sm" variant="ghost" icon aria-label={t("common.remove")} onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}><IconTrash size={16} /></Button> : null}
                </div>
                <Field label={t("action.titleField")} required error={errors[`a${i}.title`]}><Input value={d.title} onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, title: e.target.value } : x)))} maxLength={160} /></Field>
                <Field label={t("action.problem")} optional><Textarea rows={2} value={d.problem ?? ""} onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, problem: e.target.value } : x)))} maxLength={500} /></Field>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <Field label={t("common.owner")} required error={errors[`a${i}.owner`]}><UserSelect users={users} value={d.ownerUserId} meId={me?.id} onChange={(id) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, ownerUserId: id } : x)))} /></Field>
                  <Field label={t("common.dueDate")} required>
                    <Input type="datetime-local" value={toLocalInput(d.dueAt)} onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, dueAt: fromLocalInput(e.target.value) } : x)))} />
                  </Field>
                </div>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <Field label={t("action.type")}><Select value={d.actionType} onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, actionType: e.target.value as ActionType } : x)))} style={{ width: "auto" }}>{ACTION_TYPES.map((a) => <option key={a} value={a}>{t(`action.type.${a}`)}</option>)}</Select></Field>
                  <Field label={t("action.control")}><Select value={d.controlLevel} onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, controlLevel: e.target.value as ControlLevel } : x)))} style={{ width: "auto" }}>{CONTROLS.map((c) => <option key={c} value={c}>{t(`control.${c}`)}</option>)}</Select></Field>
                  <Field label={t("common.employer")} optional><Select value={d.responsibleEmployerId ?? ""} onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, responsibleEmployerId: e.target.value || null } : x)))} style={{ width: "auto" }}><option value="">{t("common.none")}</option>{contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                </div>
                {d.interimControl !== undefined ? (
                  <Field label={t("action.interim")} required={d.band === "high" || d.band === "extreme"} error={errors[`a${i}.interim`]} hint={d.interimReviewAt ? t("action.interimReview", { time: fmtDateTime(d.interimReviewAt) }) : undefined}>
                    <Input value={d.interimControl} onChange={(e) => setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, interimControl: e.target.value } : x)))} maxLength={300} />
                  </Field>
                ) : null}
                <div className="small muted">{t("triage.bandDue", { band: t(`band.${d.band}`), score: score ?? "" })}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {decision === "return_to_reporter" ? (
        <Field label={t("triage.question")} required error={errors.question} hint={obs.anonymous || obs.channel === "qr" ? t("triage.noReturnAnonymous") : t("triage.questionHint")}>
          <Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} disabled={obs.anonymous || obs.channel === "qr"} />
        </Field>
      ) : null}

      {decision === "reviewed_no_action" || decision === "discard" ? (
        <div style={{ marginTop: 12 }}>
          <Field label={t("triage.reasonCode")} required error={errors.reason}>
            <ChipBar wrap>{(decision === "discard" ? DISCARD_REASONS : NO_ACTION_REASONS).map((r) => <Chip key={r} on={reasonCode === r} onClick={() => setReasonCode(r)}>{t(`triage.reason.${r}`)}</Chip>)}</ChipBar>
          </Field>
          <Field label={t("triage.reasonText")} required error={errors.reasonText} hint={decision === "discard" ? t("triage.discardHint") : undefined}>
            <Textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} maxLength={500} />
          </Field>
        </div>
      ) : null}

      {decision === "merge_duplicate" ? (
        <div style={{ marginTop: 12 }}>
          <Field label={t("triage.master")} required error={errors.master} hint={t("triage.masterHint")}>
            {duplicates?.length ? (
              <div className="list" style={{ marginBottom: 8 }}>
                {duplicates.map((dup) => (
                  <button key={dup.id} type="button" className={`decision-btn dup`} aria-pressed={masterId === dup.id} onClick={() => setMasterId(dup.id)}>
                    <span><b className="mono">{dup.caseNo}</b> · {t(`type.${dup.type}`)} · {relative(dup.receivedAt, t)}<br /><span className="small muted">{dup.description.slice(0, 90)} · {dup.reasons.join(", ")} · {Math.round(dup.score * 100)}%</span></span>
                  </button>
                ))}
              </div>
            ) : null}
            <Input value={masterSearch} onChange={(e) => setMasterSearch(e.target.value)} placeholder={t("triage.masterSearch")} />
            <div className="list" style={{ marginTop: 8 }}>
              {masterCandidates.map((o) => (
                <button key={o.id} type="button" className="decision-btn" aria-pressed={masterId === o.id} onClick={() => setMasterId(o.id)}>
                  <span><b className="mono">{o.caseNo}</b> · {t(`obs.status.${o.status}`)}<br /><span className="small muted">{o.description.slice(0, 90)}</span></span>
                </button>
              ))}
              {masterCandidates.length === 0 ? <span className="small muted">{t("triage.noMaster")}</span> : null}
            </div>
          </Field>
        </div>
      ) : null}

      {decision === "escalate_incident" ? (
        <div style={{ marginTop: 12 }}>
          <div className="banner warn" style={{ marginBottom: 10 }}><IconAlert size={18} /><span>{t("triage.escalateHint")}</span></div>
          <Field label={t("triage.learnedAt")} required error={errors.learnedAt} hint={t("triage.learnedHint")}>
            <Input type="datetime-local" value={learnedAt} onChange={(e) => setLearnedAt(e.target.value)} />
          </Field>
        </div>
      ) : null}
    </Sheet>
  );
}

export function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string {
  return v ? new Date(v).toISOString() : "";
}
