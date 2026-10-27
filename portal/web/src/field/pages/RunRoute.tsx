/* Inspection run: header once, one section per screen with progress, answer in any order, show_if logic, repeatable
   sections, fail → photo + note + draft action inline (defaults from the question), signature and a submit summary.
   Answers autosave to the draft store (crash recovery) and are sent as `answers` + `submit` commands.
   Completed runs open the read-only detail with the locked answers, score, actions and the report link. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ActionDraft, Answer, Media, MediaRef, Question, RunDetail as Detail, Section, Band } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Card, CardHead, Chip, ChipBar, Confirm, ErrorCard, Field, Input, Lightbox, Pill, Progress, Select, Skeleton, Textarea, useToast, BandPill, Thumb } from "../../shared/ui";
import { useBeforeUnload, useGeo } from "../../shared/hooks";
import { IconAlert, IconCheck, IconForward, IconBack, IconPlus, IconExternal, IconFlag } from "../../shared/icons";
import { fmtDateTime } from "../../shared/format";
import { dueFromRule, ruleFor } from "../../shared/risk";
import { signatureFromCanvas } from "../../shared/image";
import { uuid } from "../../shared/storage";
import { errorKey } from "../../shared/api";
import { api } from "../api";
import { useSession, isOfficer, hasRole } from "../session";
import { useDetail, useDraft, useRefData, useRuns, useActions, useObservations } from "../offline/store";
import { saveAnswers, submitRun } from "../offline/commands";
import { PendingMarkers, SubHead, RunStatusChip, UserSelect, useOnlineOnly } from "../components/common";
import { PhotoStrip, SignaturePad, photoBytes, type PhotoDraft } from "../components/media";
import { toLocalInput, fromLocalInput } from "../components/triage";
import { assignable, questionFlag, suggestOwner } from "../lib";

interface AnswerState { value: unknown; note: string; photos: PhotoDraft[]; action: ActionDraft | null; answeredAt: string; signature?: { blob: Blob; sha: string } | null }
interface RunDraft { answers: Record<string, AnswerState>; repeats: Record<string, number>; step: number; immediateAction: string; tagStatus: "safe_to_use" | "do_not_use" | ""; header: Record<string, string>; headerDone: boolean }
const key = (qId: string, rep: number) => `${qId}#${rep}`;

export default function RunRoute() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const { me } = useSession();
  const { data: runs } = useRuns();
  const local = runs.find((r) => r.id === id || r.clientUuid === id) ?? null;
  const { data: detail, loading, error, reload, update } = useDetail<Detail>("run", local?.local ? null : id, () => api.get<Detail>(`/inspections/runs/${id}`));
  const run = detail ?? local;
  if (!run && loading) return <div className="page"><SubHead title={t("nav.inspections")} /><Skeleton lines={8} /></div>;
  if (!run) return <div className="page"><SubHead title={t("nav.inspections")} /><ErrorCard error={error ?? new Error(t("error.notFound"))} onRetry={reload} /></div>;
  const mineToAnswer = (run.status === "in_progress" || run.status === "scheduled") && (!run.inspectorUserId || run.inspectorUserId === me?.id || (detail?.can.answer ?? true));
  if (mineToAnswer) return <RunScreen run={run} detail={detail} />;
  return <RunDetailView run={run} detail={detail} loading={loading} error={error} reload={reload} update={update} />;
}

/* ================================================================ answering */
function RunScreen({ run, detail }: { run: Detail | NonNullable<ReturnType<typeof useRuns>["data"][number]>; detail: Detail | null }) {
  const { t, pick, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const ref = useRefData();
  const { data: actions } = useActions();
  const { data: observations } = useObservations();
  const geo = useGeo(true);
  const template = ref.templates.find((tv) => tv.id === run.templateVersionId) ?? null;
  const { value: d, set, ready, clear, dirty, restored } = useDraft<RunDraft>(`run:${run.clientUuid}`, { answers: {}, repeats: {}, step: 0, immediateAction: "", tagStatus: "", header: {}, headerDone: false });
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [sigCanvas, setSigCanvas] = useState<HTMLCanvasElement | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useBeforeUnload(dirty);

  // seed header and any answers the server already has for this run
  useEffect(() => {
    if (!ready || !template) return;
    set((p) => {
      const next = { ...p };
      if (Object.keys(p.header).length === 0) next.header = { ...(detail?.header ?? ("header" in run ? (run as Detail).header : {})) };
      if (detail && Object.keys(p.answers).length === 0 && detail.answers.length) {
        const ans: Record<string, AnswerState> = {};
        for (const a of detail.answers) ans[key(a.questionId, a.repeatIndex)] = { value: a.value, note: a.note ?? "", photos: [], action: a.action ?? null, answeredAt: a.answeredAt };
        next.answers = ans;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, template?.id, detail?.id]);

  const site = ref.sites.find((s) => s.id === run.siteId);
  const area = ref.areas.find((a) => a.id === run.areaId);
  const asset = ref.assets.find((a) => a.id === run.assetId);
  const sections = useMemo(() => (template ? [...template.sections].sort((a, b) => a.sort - b.sort) : []), [template]);
  // steps: 0 = header, 1..n = sections, n+1 = summary
  const steps = sections.length + 2;
  const step = Math.min(d.step, steps - 1);
  const repeatsOf = (s: Section) => (s.repeatable ? Math.max(1, d.repeats[s.id] ?? 1) : 1);
  const visible = useCallback((q: Question, s: Section, rep: number) => {
    if (!q.showIf) return true;
    const dep = s.questions.find((x) => x.code === q.showIf!.questionCode) ?? sections.flatMap((x) => x.questions).find((x) => x.code === q.showIf!.questionCode);
    if (!dep) return true;
    const v = d.answers[key(dep.id, rep)]?.value ?? d.answers[key(dep.id, 0)]?.value;
    return String(v ?? "") === q.showIf.equals;
  }, [d.answers, sections]);

  const stats = useMemo(() => {
    let total = 0, done = 0, flagged = 0, missingActions = 0, scored = 0, scoreSum = 0, maxSum = 0;
    const required: string[] = [];
    for (const s of sections) for (let rep = 0; rep < repeatsOf(s); rep++) for (const q of s.questions) {
      if (!visible(q, s, rep)) continue;
      total++;
      const a = d.answers[key(q.id, rep)];
      const answered = a && a.value !== null && a.value !== undefined && a.value !== "" && !(Array.isArray(a.value) && a.value.length === 0) && !(q.answerType === "photo" && a.photos.length === 0 && !a.value) && !(q.answerType === "signature" && !a.signature && !a.value);
      if (answered) done++; else if (q.required) required.push(`${pick(s.title)} · ${pick(q.text)}`);
      if (answered && questionFlag(q, a.value)) {
        flagged++;
        if (q.actionOnFail && !a.action) missingActions++;
      }
      if (answered && (q.answerType === "pass_fail_na" || q.answerType === "single_choice")) {
        const opt = q.responseSet.find((o) => o.value === a.value);
        const max = Math.max(0, ...q.responseSet.map((o) => o.score ?? 0));
        if (opt && opt.score !== null && max > 0) { scored++; scoreSum += opt.score; maxSum += max; }
      } else if (answered && q.answerType === "number") { scored++; maxSum += 1; scoreSum += questionFlag(q, a.value) ? 0 : 1; }
    }
    const pct = maxSum > 0 ? Math.round((scoreSum / maxSum) * 100) : null;
    const anyFail = template?.scoring.anyFailRule ?? true;
    const result: "pass" | "fail" | null = pct === null && flagged === 0 && scored === 0 ? null : (anyFail && flagged > 0) || (pct !== null && pct < (template?.scoring.passMarkPct ?? 80)) ? "fail" : "pass";
    return { total, done, flagged, missingActions, pct, result, required };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, sections, template, visible, pick]);

  const setAnswer = (q: Question, rep: number, patch: Partial<AnswerState>) => set((p) => {
    const k = key(q.id, rep);
    const prev = p.answers[k] ?? { value: null, note: "", photos: [], action: null, answeredAt: "" };
    const next: AnswerState = { ...prev, ...patch, answeredAt: new Date().toISOString() };
    // a fail with action-on-fail gets a pre-filled draft action straight away (removable); a pass drops it
    if ("value" in patch) {
      const flagged = questionFlag(q, next.value);
      if (flagged && q.actionOnFail && !next.action) next.action = draftFor(q);
      if (!flagged) next.action = null;
    }
    return { ...p, answers: { ...p.answers, [k]: next } };
  });
  const draftFor = (q: Question): ActionDraft => {
    const band: Band = q.actionDefaults.band ?? "moderate";
    const rule = ruleFor(ref.dueDateRules, band, run.siteId);
    const due = q.actionDefaults.dueOffsetHours ? new Date(Date.now() + q.actionDefaults.dueOffsetHours * 3_600_000) : dueFromRule(rule, new Date(), site?.workingCalendar.weeklyOff);
    const byRole = q.actionDefaults.ownerRole ? ref.directory.find((u) => u.active && u.roles.some((r) => r.role === q.actionDefaults.ownerRole && (r.siteId === null || r.siteId === run.siteId)))?.id : undefined;
    const owner = q.actionDefaults.ownerUserId ?? byRole ?? suggestOwner(ref, actions, observations, run.siteId, run.areaId, null) ?? me?.id ?? "";
    return { clientUuid: uuid(), title: pick(q.text).slice(0, 140), problem: "", actionType: "corrective", controlLevel: q.actionDefaults.controlLevel ?? "engineering", ownerUserId: owner, band, dueAt: due.toISOString(), interimControl: rule.interimControlRequired ? "" : undefined };
  };

  const buildAnswers = (): { answers: Answer[]; media: { ref: MediaRef; blob: Blob }[] } => {
    const out: Answer[] = [];
    const media: { ref: MediaRef; blob: Blob }[] = [];
    for (const s of sections) for (let rep = 0; rep < repeatsOf(s); rep++) for (const q of s.questions) {
      const a = d.answers[key(q.id, rep)];
      if (!a || !visible(q, s, rep)) continue;
      if (a.value === null || a.value === undefined || a.value === "") { if (!a.photos.length && !a.signature) continue; }
      const refs = a.photos.map((p) => p.ref);
      for (const p of a.photos) media.push(photoBytes(p));
      out.push({ clientUuid: uuid(), questionId: q.id, repeatIndex: rep, value: q.answerType === "photo" ? a.photos.length : a.value, note: a.note || undefined, media: refs.length ? refs : undefined, action: a.action ?? null, answeredAt: a.answeredAt || new Date().toISOString(), lat: geo.lat, lng: geo.lng });
    }
    return { answers: out, media };
  };

  const saveAndExit = async () => {
    setBusy(true);
    try {
      const { answers, media } = buildAnswers();
      if (answers.length) await saveAnswers(run.id, answers, media, `${pick(run.templateName)} · ${t("run.progressSaved")}`);
      toast.success(t("run.progressSaved"));
      nav("/inspections");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const submit = async () => {
    const errs: string[] = [];
    if (stats.required.length) errs.push(t("run.unanswered", { count: stats.required.length }), ...stats.required.slice(0, 5));
    if (stats.missingActions) errs.push(t("run.missingActions", { count: stats.missingActions }));
    if (!sigCanvas) errs.push(t("run.needSignature"));
    if (asset && !d.tagStatus) errs.push(t("run.needTag"));
    setErrors(errs);
    if (errs.length) { toast.error(t("error.validation")); return; }
    setBusy(true);
    try {
      const sig = await signatureFromCanvas(sigCanvas!);
      if (!sig) throw new Error(t("run.needSignature"));
      const { answers, media } = buildAnswers();
      const ansCmd = await saveAnswers(run.id, answers, media, `${pick(run.templateName)} · ${t("run.answers")}`);
      await submitRun(run.id, { clientUuid: uuid(), answers, signature: sig.ref, immediateAction: d.immediateAction || undefined, tagStatus: asset ? (d.tagStatus || null) : null, completedAt: new Date().toISOString(), lat: geo.lat, lng: geo.lng }, [{ ref: sig.ref, blob: sig.blob }], `${pick(run.templateName)} · ${t("run.submit")}`, [ansCmd.commandId]);
      await clear();
      toast.success(t("run.submitted", { result: stats.result ? t(`run.${stats.result}`) : "", actions: answers.filter((a) => a.action).length }));
      nav("/inspections");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (!template) return <div className="page"><SubHead title={pick(run.templateName)} /><ErrorCard error={new Error(t("run.templateMissing"))} onRetry={() => location.reload()} /></div>;
  if (!ready) return <div className="page"><Skeleton lines={6} /></div>;
  const section = step >= 1 && step <= sections.length ? sections[step - 1] : null;

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <SubHead title={pick(template.name)} kicker={`${run.caseNo || t("common.pendingNumber")} · v${template.version}${asset ? ` · ${asset.tagNo}` : area ? ` · ${pick(area.name)}` : ""}`} back={() => setConfirmExit(true)}
        right={<Button size="sm" onClick={saveAndExit} loading={busy}>{t("run.saveExit")}</Button>} />
      <PendingMarkers targetId={run.id} />
      {restored ? <div className="hint-box" style={{ marginBottom: 8 }}>{t("run.restored")}</div> : null}
      <div className="run-head">
        <Progress value={stats.done} max={Math.max(1, stats.total)} hivis label={t("run.progress")} />
        <span className="small muted" style={{ whiteSpace: "nowrap" }}>{stats.done}/{stats.total}{stats.flagged ? ` · ${t("run.failedCount", { count: stats.flagged })}` : ""}</span>
      </div>
      <div className="section-nav" role="tablist">
        <button type="button" role="tab" aria-current={step === 0} className={d.headerDone ? "done" : ""} onClick={() => set((p) => ({ ...p, step: 0 }))}>{t("run.header")}</button>
        {sections.map((s, i) => {
          const qs = s.questions.length * repeatsOf(s);
          const answered = Object.keys(d.answers).filter((k) => s.questions.some((q) => k.startsWith(q.id + "#")) && d.answers[k].value !== null && d.answers[k].value !== "").length;
          const flagged = s.questions.some((q) => Array.from({ length: repeatsOf(s) }).some((_, rep) => questionFlag(q, d.answers[key(q.id, rep)]?.value)));
          return <button key={s.id} type="button" role="tab" aria-current={step === i + 1} className={flagged ? "flag" : answered >= qs ? "done" : ""} onClick={() => set((p) => ({ ...p, step: i + 1 }))}>{i + 1}. {pick(s.title)}</button>;
        })}
        <button type="button" role="tab" aria-current={step === steps - 1} onClick={() => set((p) => ({ ...p, step: steps - 1 }))}>{t("run.summary")}</button>
      </div>

      {step === 0 ? (
        <Card>
          <CardHead title={t("run.header")} kicker={t("run.headerOnce")} />
          <dl className="kv">
            <dt>{t("common.site")}</dt><dd>{site ? `${site.code} · ${pick(site.name)}` : "—"}</dd>
            <dt>{t("common.area")}</dt><dd>{area ? pick(area.name) : "—"}</dd>
            {asset ? <><dt>{t("common.asset")}</dt><dd>{asset.tagNo} · {t(`assetClass.${asset.assetClass}`)}</dd></> : null}
            <dt>{t("common.date")}</dt><dd>{fmtDateTime(run.startedAt ?? new Date().toISOString(), lang)}</dd>
            <dt>{t("run.inspector")}</dt><dd>{me?.name}</dd>
            <dt>{t("run.docNo")}</dt><dd className="mono">{d.header.docNo ?? ""}</dd>
            <dt>{t("common.gps")}</dt><dd>{geo.state === "ok" ? t("common.gpsAcc", { m: geo.accuracyM }) : t("common.gpsNone")}</dd>
          </dl>
          {template.titleFields.filter((f) => !["site", "area", "asset", "date", "inspector", "docNo"].includes(f)).map((f) => (
            <Field key={f} label={t(`run.field.${f}`) === `run.field.${f}` ? f : t(`run.field.${f}`)}><Input value={d.header[f] ?? ""} onChange={(e) => set((p) => ({ ...p, header: { ...p.header, [f]: e.target.value } }))} /></Field>
          ))}
          <Button variant="primary" block onClick={() => set((p) => ({ ...p, headerDone: true, step: 1 }))} data-testid="header-next">{t("run.beginChecks")} <IconForward size={18} /></Button>
        </Card>
      ) : null}

      {section ? (
        <div>
          {Array.from({ length: repeatsOf(section) }).map((_, rep) => (
            <div key={rep}>
              {section.repeatable ? <div className="group-title">{section.repeatLabel || pick(section.title)} {rep + 1}</div> : null}
              {section.questions.filter((q) => visible(q, section, rep)).sort((a, b) => a.sort - b.sort).map((q) => (
                <QuestionCard key={key(q.id, rep)} q={q} a={d.answers[key(q.id, rep)]} onChange={(patch) => setAnswer(q, rep, patch)} siteId={run.siteId} />
              ))}
            </div>
          ))}
          {section.repeatable ? <Button onClick={() => set((p) => ({ ...p, repeats: { ...p.repeats, [section.id]: repeatsOf(section) + 1 } }))}><IconPlus size={16} /> {t("run.addRepeat", { label: section.repeatLabel || pick(section.title) })}</Button> : null}
          <div className="row between" style={{ marginTop: 14 }}>
            <Button onClick={() => set((p) => ({ ...p, step: step - 1 }))}><IconBack size={16} /> {t("common.back")}</Button>
            <Button variant="primary" onClick={() => set((p) => ({ ...p, step: step + 1 }))} data-testid="section-next">{step === sections.length ? t("run.summary") : t("common.next")} <IconForward size={16} /></Button>
          </div>
        </div>
      ) : null}

      {step === steps - 1 ? (
        <Card>
          <CardHead title={t("run.summary")} />
          <div className="score">
            <div className="kpi"><span className="v">{stats.pct ?? "—"}{stats.pct !== null ? "%" : ""}</span><span className="l">{t("run.score")}</span><span className="n">{t("run.naExcluded")}</span></div>
            <div className={`kpi ${stats.result === "fail" ? "red" : stats.result === "pass" ? "green" : ""}`}><span className="v">{stats.result ? t(`run.${stats.result}`) : "—"}</span><span className="l">{t("run.result")}</span><span className="n">{template.scoring.anyFailRule ? t("run.anyFail") : t("run.passMark", { pct: template.scoring.passMarkPct })}</span></div>
            <div className={`kpi ${stats.flagged ? "orange" : ""}`}><span className="v">{Object.values(d.answers).filter((a) => a.action).length}</span><span className="l">{t("run.actionsRaised")}</span><span className="n">{t("run.failedCount", { count: stats.flagged })}</span></div>
          </div>
          {stats.required.length ? <div className="banner warn" style={{ marginTop: 10 }}><IconAlert size={16} /><span>{t("run.unanswered", { count: stats.required.length })}: {stats.required.slice(0, 3).join("; ")}{stats.required.length > 3 ? "…" : ""}</span></div> : null}
          {stats.missingActions ? <div className="banner failed" style={{ marginTop: 10 }} data-testid="missing-actions"><IconFlag size={16} /><span>{t("run.missingActions", { count: stats.missingActions })}</span></div> : null}
          <Field label={t("run.immediateAction")} optional><Textarea rows={2} value={d.immediateAction} onChange={(e) => set((p) => ({ ...p, immediateAction: e.target.value }))} maxLength={500} /></Field>
          {asset ? (
            <Field label={t("run.tagStatus")} required>
              <div className="pfn">
                <button type="button" className="green" aria-pressed={d.tagStatus === "safe_to_use"} onClick={() => set((p) => ({ ...p, tagStatus: "safe_to_use" }))}>{t("run.safeToUse")}</button>
                <button type="button" className="red" aria-pressed={d.tagStatus === "do_not_use"} onClick={() => set((p) => ({ ...p, tagStatus: "do_not_use" }))}>{t("run.doNotUse")}</button>
              </div>
            </Field>
          ) : null}
          <SignaturePad onChange={setSigCanvas} label={t("run.signature")} />
          {errors.length ? <div className="error-card" role="alert" style={{ marginTop: 10 }}><h3>{t("run.cannotSubmit")}</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div> : null}
          <div className="row between" style={{ marginTop: 14 }}>
            <Button onClick={() => set((p) => ({ ...p, step: step - 1 }))}><IconBack size={16} /> {t("common.back")}</Button>
            <Button variant="primary" size="lg" loading={busy} onClick={submit} data-testid="run-submit"><IconCheck size={18} /> {t("run.submit")}</Button>
          </div>
        </Card>
      ) : null}

      {confirmExit ? <Confirm title={t("run.exitTitle")} body={t("run.exitBody")} confirmLabel={t("run.saveExit")} onClose={() => setConfirmExit(false)} onConfirm={saveAndExit} /> : null}
    </div>
  );
}

function QuestionCard({ q, a, onChange, siteId }: { q: Question; a: AnswerState | undefined; onChange: (patch: Partial<AnswerState>) => void; siteId: string }) {
  const { t, pick } = useI18n();
  const { me } = useSession();
  const ref = useRefData();
  const value = a?.value ?? null;
  const flagged = questionFlag(q, value);
  const opts = q.responseSet.length ? q.responseSet : [
    { value: "pass", label: { en: t("run.pass") }, colour: "green" as const, flag: false, score: 1 }, { value: "fail", label: { en: t("run.fail") }, colour: "red" as const, flag: true, score: 0 }, { value: "na", label: { en: t("run.na") }, colour: "grey" as const, flag: false, score: null },
  ];
  const users = assignable(ref, siteId);
  return (
    <div className={`q${flagged ? " flag" : ""}`} data-testid={`q-${q.code}`}>
      <div className="qt">{q.sort}. {pick(q.text)}{q.required ? <span className="req" aria-hidden>*</span> : null}</div>
      {q.guidance?.en ? <div className="guide">{pick(q.guidance)}</div> : null}
      {q.guidanceMediaUrl ? <img src={api.file(q.guidanceMediaUrl)} alt="" style={{ maxHeight: 160, borderRadius: 8, marginBottom: 8 }} /> : null}
      {q.answerType === "pass_fail_na" || q.answerType === "single_choice" ? (
        <div className={q.answerType === "pass_fail_na" ? "pfn" : "cat-chips"} role="group" aria-label={pick(q.text)}>
          {opts.map((o) => q.answerType === "pass_fail_na"
            ? <button key={o.value} type="button" className={o.colour} aria-pressed={value === o.value} onClick={() => onChange({ value: o.value })} data-testid={`ans-${o.value}`}>{pick(o.label)}</button>
            : <Chip key={o.value} size="lg" on={value === o.value} onClick={() => onChange({ value: o.value })}>{pick(o.label)}</Chip>)}
        </div>
      ) : q.answerType === "multi_choice" ? (
        <ChipBar wrap>{opts.map((o) => { const arr = Array.isArray(value) ? (value as string[]) : []; return <Chip key={o.value} size="lg" on={arr.includes(o.value)} onClick={() => onChange({ value: arr.includes(o.value) ? arr.filter((x) => x !== o.value) : [...arr, o.value] })}>{pick(o.label)}</Chip>; })}</ChipBar>
      ) : q.answerType === "number" ? (
        <div className="input-row" style={{ alignItems: "center" }}>
          <Input type="number" inputMode="decimal" value={value === null ? "" : String(value)} min={q.min ?? undefined} max={q.max ?? undefined} onChange={(e) => onChange({ value: e.target.value === "" ? null : Number(e.target.value) })} style={{ maxWidth: 180 }} />
          <span className="small muted">{q.unit}{q.passMin !== null || q.passMax !== null ? ` · ${t("run.passRange", { min: q.passMin ?? "", max: q.passMax ?? "" })}` : ""}</span>
        </div>
      ) : q.answerType === "text" ? (
        <Textarea rows={2} value={typeof value === "string" ? value : ""} onChange={(e) => onChange({ value: e.target.value })} maxLength={1000} />
      ) : q.answerType === "date" ? (
        <Input type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange({ value: e.target.value })} style={{ maxWidth: 220 }} />
      ) : q.answerType === "photo" ? (
        <PhotoStrip photos={a?.photos ?? []} onChange={(photos) => onChange({ photos, value: photos.length ? photos.length : null })} max={10} purpose="evidence" />
      ) : q.answerType === "signature" ? (
        <SignaturePad onChange={(c) => { if (!c) { onChange({ value: null, signature: null }); return; } void signatureFromCanvas(c).then((s) => s && onChange({ value: s.ref.sha256, signature: { blob: s.blob, sha: s.ref.sha256 } })); }} />
      ) : null}
      {flagged ? (
        <div className="fail-follow" data-testid="fail-follow">
          {q.photoOnFail ? <PhotoStrip photos={a?.photos ?? []} onChange={(photos) => onChange({ photos })} max={10} purpose="before" label={t("run.photoOnFail")} required /> : null}
          {q.noteOnFail ? <Field label={t("run.noteOnFail")} required><Textarea rows={2} value={a?.note ?? ""} onChange={(e) => onChange({ note: e.target.value })} maxLength={500} /></Field> : null}
          {q.actionOnFail ? (
            a?.action ? (
              <div className="action-draft">
                <div className="row between"><span className="defaults-note"><IconFlag size={14} /> {t("run.actionDraft")}</span><BandPill band={a.action.band ?? "moderate"} /></div>
                <Field label={t("action.titleField")} required><Input value={a.action.title} onChange={(e) => onChange({ action: { ...a.action!, title: e.target.value } })} maxLength={160} /></Field>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <Field label={t("common.owner")} required><UserSelect users={users} value={a.action.ownerUserId} meId={me?.id} onChange={(id) => onChange({ action: { ...a.action!, ownerUserId: id } })} /></Field>
                  <Field label={t("common.dueDate")} required><Input type="datetime-local" value={toLocalInput(a.action.dueAt)} onChange={(e) => onChange({ action: { ...a.action!, dueAt: fromLocalInput(e.target.value) } })} /></Field>
                  <Field label={t("common.risk")}><Select value={a.action.band ?? "moderate"} onChange={(e) => onChange({ action: { ...a.action!, band: e.target.value as Band } })} style={{ width: "auto" }}>{(["low", "moderate", "high", "extreme"] as Band[]).map((b) => <option key={b} value={b}>{t(`band.${b}`)}</option>)}</Select></Field>
                </div>
                {a.action.interimControl !== undefined ? <Field label={t("action.interim")} required={a.action.band === "high" || a.action.band === "extreme"}><Input value={a.action.interimControl} onChange={(e) => onChange({ action: { ...a.action!, interimControl: e.target.value } })} /></Field> : null}
              </div>
            ) : <Button size="sm" variant="primary" onClick={() => onChange({ value })} data-testid="draft-action"><IconPlus size={16} /> {t("run.draftAction")}</Button>
          ) : null}
        </div>
      ) : null}
      {!flagged && q.answerType !== "photo" && a?.photos.length ? <div style={{ marginTop: 8 }}><PhotoStrip photos={a.photos} onChange={(photos) => onChange({ photos })} max={10} purpose="evidence" /></div> : null}
      {q.referenceText ? <div className="refx"><span>{q.referenceText}</span><Pill>{t(`common.verifyLabel.${q.referenceStatus}`)}</Pill></div> : null}
    </div>
  );
}

/* ================================================================ read-only detail */
function RunDetailView({ run, detail, loading, error, reload, update }: { run: NonNullable<ReturnType<typeof useRuns>["data"][number]> | Detail; detail: Detail | null; loading: boolean; error: unknown; reload: () => void; update: (d: Detail) => void }) {
  const { t, pick, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const ref = useRefData();
  const { online } = useOnlineOnly();
  const [view, setView] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [reopen, setReopen] = useState(false);
  const template = ref.templates.find((tv) => tv.id === run.templateVersionId);
  const area = ref.areas.find((a) => a.id === run.areaId);
  const asset = ref.assets.find((a) => a.id === run.assetId);
  const questions = new Map((template?.sections ?? []).flatMap((s) => s.questions.map((q) => [q.id, { q, s }] as const)));
  const officer = isOfficer(me, run.siteId);
  const canReopen = detail ? detail.can.reopen : hasRole(me, ["admin", "hse_manager"]);
  const canCancel = detail ? detail.can.cancel : officer && run.status === "scheduled";
  const act = async (path: string, reason: string, ok: string) => {
    try { const d = await api.post<Detail>(path, { reason }); update(d); toast.success(ok); } catch (e) { const { key, message } = errorKey(e); toast.error(key === "error.generic" ? message : t(key)); }
  };
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <SubHead title={pick(run.templateName)} kicker={<span className="row" style={{ gap: 6 }}><span className="mono">{run.caseNo || t("common.pendingNumber")}</span><RunStatusChip status={run.status} result={run.result} />{run.tagStatus ? <Pill tone={run.tagStatus === "safe_to_use" ? "green" : "red"} dot>{t(`run.${run.tagStatus === "safe_to_use" ? "safeToUse" : "doNotUse"}`)}</Pill> : null}</span>}
        right={detail?.reportUrl || (run.status === "completed" || run.status === "closed") ? <Button size="sm" disabled={!online} title={online ? undefined : t("common.needsConnection")} onClick={() => window.open(api.file(detail?.reportUrl ?? `/api/v1/inspections/runs/${run.id}/report`), "_blank", "noopener")}><IconExternal size={16} /> {t("run.report")}</Button> : null} />
      <PendingMarkers targetId={run.id} />
      {error && !detail ? <ErrorCard error={error} onRetry={reload} /> : null}
      <Card>
        <div className="score">
          <div className="kpi"><span className="v">{run.scorePct ?? "—"}{run.scorePct !== null ? "%" : ""}</span><span className="l">{t("run.score")}</span></div>
          <div className={`kpi ${run.result === "fail" ? "red" : run.result === "pass" ? "green" : ""}`}><span className="v">{run.result ? t(`run.${run.result}`) : "—"}</span><span className="l">{t("run.result")}</span></div>
          <div className={`kpi ${run.failedCount ? "orange" : ""}`}><span className="v">{run.actionsRaised}</span><span className="l">{t("run.actionsRaised")}</span><span className="n">{t("run.failedCount", { count: run.failedCount })}</span></div>
        </div>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>{t("common.site")}</dt><dd>{ref.sites.find((s) => s.id === run.siteId)?.code ?? ""}{area ? ` · ${pick(area.name)}` : ""}{asset ? ` · ${asset.tagNo}` : ""}</dd>
          <dt>{t("run.inspector")}</dt><dd>{run.inspectorName ?? "—"}</dd>
          <dt>{t("common.date")}</dt><dd>{fmtDateTime(run.completedAt ?? run.startedAt ?? run.dueAt, lang)}</dd>
          {detail?.immediateAction ? <><dt>{t("run.immediateAction")}</dt><dd>{detail.immediateAction}</dd></> : null}
          {detail?.reopenReason ? <><dt>{t("run.status.reopened")}</dt><dd>{detail.reopenReason}</dd></> : null}
        </dl>
        {detail?.signature?.url ? <img src={api.file(detail.signature.url)} alt={t("run.signature")} style={{ maxHeight: 80, marginTop: 8 }} /> : null}
      </Card>
      {run.status === "scheduled" || run.status === "in_progress" ? (
        <div className="btn-group" style={{ marginTop: 12 }}>
          {run.inspectorUserId && run.inspectorUserId !== me?.id ? <p className="small muted">{t("run.assignedTo", { name: run.inspectorName ?? "" })}</p> : null}
          {canCancel ? <Button variant="ghost" disabled={!online} onClick={() => setCancel(true)}>{t("run.cancel")}</Button> : null}
        </div>
      ) : null}
      {canReopen && (run.status === "completed" || run.status === "closed") ? <div style={{ marginTop: 12 }}><Button variant="ghost" disabled={!online} title={online ? undefined : t("common.needsConnection")} onClick={() => setReopen(true)}>{t("run.reopen")}</Button></div> : null}
      {loading && !detail ? <Skeleton lines={6} className="card" /> : detail ? (
        <section style={{ marginTop: 14 }}>
          <h3>{t("run.answers")}</h3>
          {detail.answers.map((a) => {
            const qq = questions.get(a.questionId);
            const opt = qq?.q.responseSet.find((o) => o.value === a.value);
            return (
              <div key={a.id} className={`q${a.flag ? " flag" : ""}`}>
                <div className="qt">{qq ? `${qq.q.sort}. ${pick(qq.q.text)}` : a.questionId}{a.repeatIndex ? ` (${a.repeatIndex + 1})` : ""}{a.repeatFinding ? <span className="repeat"> · {t("run.repeatFinding")}</span> : null}</div>
                <div className="row">
                  <Pill tone={a.flag ? "red" : opt?.colour === "green" ? "green" : "grey"} dot>{opt ? pick(opt.label) : Array.isArray(a.value) ? a.value.join(", ") : String(a.value ?? "—")}</Pill>
                  {a.note ? <span className="small">{a.note}</span> : null}
                  {a.actionId ? <Button size="sm" variant="ghost" onClick={() => nav(`/a/${a.actionId}`)}><IconFlag size={14} /> {t("run.openAction")}</Button> : null}
                </div>
                {a.media.length ? <div className="row" style={{ marginTop: 6 }}>{(a.media as Media[]).map((m) => <Thumb key={m.id} media={m} src={m.url ? api.file(m.url) : undefined} onClick={() => m.url && setView(api.file(m.url))} />)}</div> : null}
              </div>
            );
          })}
          {detail.answers.length === 0 ? <p className="small muted">{t("run.noAnswers")}</p> : null}
        </section>
      ) : <p className="small muted" style={{ marginTop: 12 }}>{t("run.answersOffline")}</p>}
      {view ? <Lightbox src={view} onClose={() => setView(null)} /> : null}
      {cancel ? <Confirm title={t("run.cancel")} confirmLabel={t("run.cancel")} danger reasonRequired onClose={() => setCancel(false)} onConfirm={async (r) => { await act(`/inspections/runs/${run.id}/cancel`, r, t("run.cancelled")); setCancel(false); }} /> : null}
      {reopen ? <Confirm title={t("run.reopen")} confirmLabel={t("run.reopen")} reasonRequired body={t("run.reopenHint")} onClose={() => setReopen(false)} onConfirm={async (r) => { await act(`/inspections/runs/${run.id}/reopen`, r, t("run.reopened")); setReopen(false); }} /> : null}
    </div>
  );
}
