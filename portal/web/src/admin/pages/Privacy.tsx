/* Privacy (DPDP): versioned notices in 4 languages with effective dates; requests queue (access, correction, erasure, nomination, grievance)
   with 90-day due dates and status. */
import { useEffect, useState } from "react";
import { useI18n, LANGS, LANG_NAMES } from "../../shared/i18n";
import type { Lang } from "../../shared/types";
import { Button, Card, CardHead, DataTable, EmptyState, ErrorCard, Field, Input, Pill, Select, Sheet, Skeleton, Tabs, Textarea, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { dueText, fmtDate, fmtDateTime } from "../../shared/format";
import { IconPlus, IconShield } from "../../shared/icons";
import { api, asList, errMessage, localCsv } from "../api";
import { useAuth } from "../auth";
import { useScope } from "../scope";
import type { PrivacyNotice, PrivacyRequest, PrivacyRequestStatus, PrivacyRequestType } from "../types";
import { ExportButton, KV, PageHead } from "../components";

const TYPES: PrivacyRequestType[] = ["access", "correction", "erasure", "nomination", "grievance"];
const STATUSES: PrivacyRequestStatus[] = ["open", "in_progress", "done", "rejected"];

export default function Privacy() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"notices" | "requests">("requests");
  return (
    <>
      <PageHead title={t("nav.privacy")} sub={t("privacy.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "requests", label: t("privacy.requests") }, { value: "notices", label: t("privacy.notices") }]} />
      <div style={{ marginTop: 14 }}>{tab === "notices" ? <NoticesTab /> : <RequestsTab />}</div>
    </>
  );
}

function NoticesTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const state = useLoad(() => api.get("/admin/privacy/notices").then((r) => asList<PrivacyNotice>(r).sort((a, b) => b.version - a.version)), []);
  const [create, setCreate] = useState(false);
  const [view, setView] = useState<Lang>("en");
  const canEdit = perms.isAdmin && !perms.readOnly;
  const cur = state.data?.[0] ?? null;
  return (
    <div className="stack">
      <div className="row between">
        <span className="small muted">{t("privacy.noticesHint")}</span>
        {canEdit ? <Button size="sm" variant="primary" onClick={() => setCreate(true)}><IconPlus size={14} />{t("privacy.newNotice")}</Button> : null}
      </div>
      {state.error && !state.data ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!state.data && !state.error ? <Skeleton lines={6} /> : null}
      {state.data && !cur ? <EmptyState icon={<IconShield />} title={t("privacy.noNotice")} body={t("privacy.noNoticeHint")} action={canEdit ? <Button size="sm" variant="primary" onClick={() => setCreate(true)}>{t("privacy.newNotice")}</Button> : undefined} /> : null}
      {cur ? (
        <div className="two-col">
          <Card>
            <CardHead title={t("privacy.currentNotice", { v: cur.version })} kicker={`${t("sites.effectiveFrom")} ${fmtDate(cur.effectiveFrom, lang)} · ${cur.createdByName ?? ""}`} action={<Select value={view} onChange={(e) => setView(e.target.value as Lang)} style={{ width: "auto" }}>{LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</Select>} />
            <div className="notice-body">{cur.body[view] || <span className="muted">{t("privacy.noTranslation")}</span>}</div>
          </Card>
          <Card>
            <CardHead title={t("privacy.versions")} />
            <div className="list-compact">{state.data!.map((n) => <div className="li" key={n.id}><strong>v{n.version}</strong><span className="sp">{fmtDate(n.effectiveFrom, lang)}</span><span className="small muted">{LANGS.filter((l) => n.body[l]).map((l) => LANG_NAMES[l]).join(", ")}</span></div>)}</div>
            <p className="small muted" style={{ marginTop: 10 }}>{t("privacy.ackNote")}</p>
          </Card>
        </div>
      ) : null}
      {create ? <NoticeSheet base={cur} onClose={() => setCreate(false)} onSaved={() => { setCreate(false); state.reload(); toast.success(t("privacy.noticePublished")); }} /> : null}
    </div>
  );
}

function NoticeSheet({ base, onClose, onSaved }: { base: PrivacyNotice | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [body, setBody] = useState<Record<Lang, string>>({ en: base?.body.en ?? "", hi: base?.body.hi ?? "", ta: base?.body.ta ?? "", kn: base?.body.kn ?? "" });
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<Lang>("en");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Sheet title={t("privacy.newNotice")} onClose={onClose} wide footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!body.en.trim() || !from} loading={busy} onClick={async () => { setBusy(true); setErr(""); try { await api.post("/admin/privacy/notices", { body, effectiveFrom: from }); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("privacy.publish")}</Button></>}>
      <p className="small muted">{t("privacy.newNoticeBody")}</p>
      <Field label={t("sites.effectiveFrom")} required><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Tabs value={tab} onChange={setTab} tabs={LANGS.map((l) => ({ value: l, label: `${LANG_NAMES[l]}${body[l].trim() ? " ✓" : ""}` }))} />
      <Field label={LANG_NAMES[tab]} required={tab === "en"}><Textarea rows={12} value={body[tab]} onChange={(e) => setBody({ ...body, [tab]: e.target.value })} /></Field>
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

function RequestsTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { siteName, sites } = useScope();
  const state = useLoad(() => api.get("/admin/privacy/requests").then((r) => asList<PrivacyRequest>(r)), []);
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<Partial<PrivacyRequest> | null>(null);
  const canEdit = perms.isAdmin && !perms.readOnly;
  const rows = (state.data ?? []).filter((r) => !status || r.status === status).sort((a, b) => Number(a.status === "done" || a.status === "rejected") - Number(b.status === "done" || b.status === "rejected") || a.dueAt.localeCompare(b.dueAt));
  const columns: Column<PrivacyRequest>[] = [
    { key: "type", label: t("privacy.type"), render: (r) => <Pill tone={r.type === "erasure" ? "red" : r.type === "grievance" ? "orange" : "blue"}>{t(`privacy.type.${r.type}`)}</Pill>, width: 120 },
    { key: "who", label: t("privacy.requester"), render: (r) => <div><div className="cell-title">{r.requesterName}</div><div className="cell-sub">{r.requesterRef} · {r.channel}{r.siteId ? ` · ${siteName(r.siteId)}` : ""}</div></div> },
    { key: "received", label: t("privacy.received"), render: (r) => fmtDate(r.receivedAt, lang), width: 110 },
    { key: "due", label: t("privacy.due"), render: (r) => { const d = dueText(r.dueAt, r.status === "open" || r.status === "in_progress", t); return <span className={d.late ? "chain-bad" : d.soon ? "" : "muted"} title={fmtDateTime(r.dueAt, lang)}>{d.text}</span>; }, sortable: true, width: 140 },
    { key: "status", label: t("common.status"), render: (r) => <Pill tone={r.status === "done" ? "green" : r.status === "rejected" ? "grey" : r.status === "in_progress" ? "blue" : "amber"}>{t(`privacy.status.${r.status}`)}</Pill>, width: 110 },
    { key: "assignee", label: t("privacy.assignee"), render: (r) => r.assigneeName ?? "—", width: 130 },
  ];
  const overdue = rows.filter((r) => (r.status === "open" || r.status === "in_progress") && new Date(r.dueAt).getTime() < Date.now()).length;
  return (
    <div className="stack">
      <div className="hint-box">{t("privacy.slaNote")}{overdue ? ` ${t("privacy.overdueN", { n: overdue })}` : ""}</div>
      <div className="filters">
        <Field label={t("common.status")}><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t("common.all")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`privacy.status.${s}`)}</option>)}</Select></Field>
        <div className="end">
          <ExportButton onExport={async () => localCsv(rows.map((r) => ({ type: r.type, requester: r.requesterName, ref: r.requesterRef, site: siteName(r.siteId), received: r.receivedAt, due: r.dueAt, status: r.status, assignee: r.assigneeName ?? "", note: r.note })), "privacy-requests.csv")} />
          {canEdit ? <Button size="sm" variant="primary" onClick={() => setEdit({ type: "access", requesterName: "", requesterRef: "", siteId: sites[0]?.id ?? null, channel: "email", status: "open", note: "" })}><IconPlus size={14} />{t("privacy.logRequest")}</Button> : null}
        </div>
      </div>
      {state.error && !state.data ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={state.loading && !state.data} onRow={(r) => setEdit(r)} empty={<EmptyState icon={<IconShield />} title={t("privacy.noRequests")} body={t("privacy.noRequestsHint")} />} />
      {edit ? <RequestSheet r={edit} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); state.reload(); toast.success(t("common.saved")); }} /> : null}
    </div>
  );
}

function RequestSheet({ r, canEdit, onClose, onSaved }: { r: Partial<PrivacyRequest>; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, lang, pick } = useI18n();
  const { sites } = useScope();
  const [f, setF] = useState<Partial<PrivacyRequest>>(r);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setF(r), [r]);
  const valid = !!f.requesterName?.trim() && !!f.requesterRef?.trim();
  return (
    <Sheet title={r.id ? `${t(`privacy.type.${r.type}`)} · ${r.requesterName}` : t("privacy.logRequest")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.close")}</Button>{canEdit ? <Button variant="primary" disabled={!valid} loading={busy} onClick={async () => { setBusy(true); setErr(""); try { if (r.id) await api.put(`/admin/privacy/requests/${r.id}`, f); else await api.post("/admin/privacy/requests", f); onSaved(); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); } }}>{t("common.save")}</Button> : null}</>}>
      {r.id ? <KV rows={[{ k: t("privacy.received"), v: fmtDateTime(r.receivedAt, lang) }, { k: t("privacy.due"), v: fmtDateTime(r.dueAt, lang) }, ...(r.closedAt ? [{ k: t("privacy.closed"), v: fmtDateTime(r.closedAt, lang) }] : [])]} /> : null}
      <div className="form-grid" style={{ marginTop: 10 }}>
        <Field label={t("privacy.type")}><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as PrivacyRequestType })} disabled={!canEdit}>{TYPES.map((x) => <option key={x} value={x}>{t(`privacy.type.${x}`)}</option>)}</Select></Field>
        <Field label={t("common.status")}><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as PrivacyRequestStatus })} disabled={!canEdit}>{STATUSES.map((x) => <option key={x} value={x}>{t(`privacy.status.${x}`)}</option>)}</Select></Field>
        <Field label={t("privacy.requester")} required><Input value={f.requesterName ?? ""} onChange={(e) => setF({ ...f, requesterName: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t("privacy.requesterRef")} required hint={t("privacy.requesterRefHint")}><Input value={f.requesterRef ?? ""} onChange={(e) => setF({ ...f, requesterRef: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t("common.site")}><Select value={f.siteId ?? ""} onChange={(e) => setF({ ...f, siteId: e.target.value || null })} disabled={!canEdit}><option value="">—</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {pick(s.name)}</option>)}</Select></Field>
        <Field label={t("privacy.channel")}><Input value={f.channel ?? ""} onChange={(e) => setF({ ...f, channel: e.target.value })} disabled={!canEdit} /></Field>
        <Field label={t("privacy.assignee")}><Input value={f.assigneeName ?? ""} onChange={(e) => setF({ ...f, assigneeName: e.target.value })} disabled={!canEdit} /></Field>
      </div>
      <Field label={t("common.note")}><Textarea rows={3} value={f.note ?? ""} onChange={(e) => setF({ ...f, note: e.target.value })} disabled={!canEdit} maxLength={1000} /></Field>
      {f.type === "erasure" ? <div className="banner warn">{t("privacy.erasureNote")}</div> : null}
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}
