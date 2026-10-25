/* Field-app building blocks shared by several screens: sync banner, pending markers, list rows with keyboard
   navigation, search box wired to "/", status chips, user select, language grid. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ActionStatus, ObservationStatus, RunStatus, Lang } from "../../shared/types";
import { useI18n, LANGS, LANG_NAMES } from "../../shared/i18n";
import { Banner, Button, Pill, BandPill, Select, Skeleton, ListSkeleton } from "../../shared/ui";
import { IconAlert, IconCheckCircle, IconRefresh, IconSearch, IconWifiOff, IconClock, IconFlag } from "../../shared/icons";
import { fmtTime, relative, dueText } from "../../shared/format";
import { useSync } from "../offline/sync";
import { useMediaMeta, usePendingFor } from "../offline/store";
import type { LocalAction, LocalObservation, LocalRun, OutboxItem } from "../offline/db";
import { TYPE_TONE } from "../lib";

/* ---------------------------------------------------------------- sync banner (brief §15.4) */
export function SyncBanner({ compact }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const s = useSync();
  const last = s.lastSyncedAt ? fmtTime(s.lastSyncedAt, lang) : t("sync.never");
  if (s.failed > 0) {
    return (
      <Banner tone="failed" icon={<IconAlert size={18} />} action={<Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); nav("/outbox"); }}>{t("outbox.open")}</Button>}>
        <span className="sync-banner" onClick={() => nav("/outbox")}>{t("sync.failed", { count: s.failed })}{s.pending ? ` · ${t("sync.waiting", { count: s.pending })}` : ""}</span>
      </Banner>
    );
  }
  if (!s.online) {
    return (
      <Banner tone="offline" icon={<IconWifiOff size={18} />} action={s.pending ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); nav("/outbox"); }}>{t("outbox.open")}</Button> : undefined}>
        <span className="sync-banner" onClick={() => nav("/outbox")}>{t("sync.offline")}{s.pending ? ` — ${t("sync.waiting", { count: s.pending })}` : ""} · {t("sync.lastSynced", { time: last })}</span>
      </Banner>
    );
  }
  if (s.syncing || s.pending > 0) {
    return (
      <Banner tone="info" icon={<IconRefresh size={18} className={s.syncing ? "spin-ico" : undefined} />} action={!s.syncing ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void s.syncNow(); }}>{t("sync.now")}</Button> : undefined}>
        <span className="sync-banner" onClick={() => nav("/outbox")}>{s.syncing ? t("sync.syncing") : t("sync.waiting", { count: s.pending })}{s.uploads.total > s.uploads.done ? ` · ${t("sync.photosUploading", { done: s.uploads.done, total: s.uploads.total })}` : ""}</span>
      </Banner>
    );
  }
  if (compact) return null;
  return (
    <Banner tone="synced" icon={<IconCheckCircle size={18} />}>
      <span className="sync-banner" onClick={() => nav("/outbox")}>{t("sync.allSynced")} · {last}</span>
    </Banner>
  );
}

/* ---------------------------------------------------------------- pending markers */
export function PendingMarkers({ targetId }: { targetId: string | null | undefined }) {
  const { t } = useI18n();
  const items = usePendingFor(targetId);
  if (items.length === 0) return null;
  return (
    <div>
      {items.map((it) => (
        <div key={it.commandId} className={`pending-marker ${it.status === "failed" ? "failed" : it.status === "conflict" ? "conflict" : ""}`}>
          {it.status === "failed" ? <IconAlert size={16} /> : <IconClock size={16} />}
          <span className="grow">
            {t(`outbox.op.${it.entityType}.${it.op}`)} · {t(`sync.status.${it.status}`)}
            {it.lastError ? <> — {it.lastError}</> : null}
          </span>
          <Link to="/outbox" className="small">{t("outbox.open")}</Link>
        </div>
      ))}
    </div>
  );
}
export function outboxStatusTone(s: OutboxItem["status"]): "green" | "blue" | "red" | "amber" | "grey" {
  return s === "synced" ? "green" : s === "failed" ? "red" : s === "conflict" ? "amber" : s === "draft" ? "grey" : "blue";
}

/* ---------------------------------------------------------------- skeletons */
export function PageSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <Skeleton lines={2} />
      <div style={{ height: 12 }} />
      <ListSkeleton rows={5} />
    </div>
  );
}

/* ---------------------------------------------------------------- status chips */
export function ObsStatusChip({ status, local }: { status: ObservationStatus; local?: boolean }) {
  const { t } = useI18n();
  if (local) return <Pill tone="blue" dot>{t("sync.status.pending")}</Pill>;
  const tone = status === "closed" ? "green" : status === "action_assigned" ? "blue" : status === "returned" ? "amber" : status === "escalated" ? "red" : status === "discarded" || status === "merged" ? "grey" : "hivis";
  return <Pill tone={tone}>{t(`obs.status.${status}`)}</Pill>;
}
export function ActionStatusChip({ status, overdue }: { status: ActionStatus; overdue?: boolean }) {
  const { t } = useI18n();
  if (overdue && !["completed", "verified", "cancelled"].includes(status)) return <Pill tone="red" dot>{t("action.overdue")}</Pill>;
  const tone = status === "verified" ? "green" : status === "completed" ? "blue" : status === "in_progress" ? "blue" : status === "reopened" ? "orange" : status === "disputed" ? "amber" : status === "cancelled" ? "grey" : "hivis";
  return <Pill tone={tone}>{t(`action.status.${status}`)}</Pill>;
}
export function RunStatusChip({ status, result }: { status: RunStatus; result?: "pass" | "fail" | null }) {
  const { t } = useI18n();
  if ((status === "completed" || status === "closed") && result) return <Pill tone={result === "pass" ? "green" : "red"} dot>{t(`run.${result}`)}</Pill>;
  const tone = status === "in_progress" ? "blue" : status === "missed" ? "red" : status === "scheduled" ? "hivis" : status === "reopened" ? "orange" : "grey";
  return <Pill tone={tone}>{t(`run.status.${status}`)}</Pill>;
}

/* ---------------------------------------------------------------- rows */
export function ObservationRow({ o, catName }: { o: LocalObservation; catName: (code: string) => string }) {
  const { t, lang, pick } = useI18n();
  const media = useMediaMeta();
  const localThumb = o.local ? media.find((m) => m.ownerClientUuid === o.clientUuid && m.ref.kind === "photo") : null;
  return (
    <Link to={`/o/${o.id}`} className={`list-item${o.local ? " local" : ""}`} data-row>
      <span className={`strip ${o.riskBand ? `band-${o.riskBand}` : ""}`} style={!o.riskBand ? { background: `var(--${TYPE_TONE[o.type]})` } : undefined} />
      <span className="body">
        <span className="row nowrap" style={{ gap: 6 }}>
          <Pill tone={TYPE_TONE[o.type]}>{t(`type.${o.type}`)}</Pill>
          {o.imminentDanger ? <Pill tone="red" dot>{t("report.dangerNow")}</Pill> : null}
          {o.anonymous ? <Pill>{t("common.anonymous")}</Pill> : null}
        </span>
        <span className="title clamp-2">{o.description || o.categoryCodes.map(catName).join(", ") || t(`type.${o.type}`)}</span>
        <span className="meta">
          <span className="mono">{o.caseNo || t("common.pendingNumber")}</span>
          {o.areaName ? <span>{pick(o.areaName)}</span> : null}
          <span>{relative(o.capturedAt, t, lang)}</span>
          {o.categoryCodes.length ? <span>{o.categoryCodes.slice(0, 2).map(catName).join(" · ")}</span> : null}
        </span>
      </span>
      <span className="aside">
        <ObsStatusChip status={o.status} local={o.local} />
        {o.riskBand ? <BandPill band={o.riskBand} /> : null}
        {o.totalActions ? <span className="small muted">{t("obs.actionsCount", { open: o.openActions, total: o.totalActions })}</span> : null}
        {localThumb ? <Pill tone="blue">{t("common.photos", { count: media.filter((m) => m.ownerClientUuid === o.clientUuid && m.ref.kind === "photo").length })}</Pill> : null}
      </span>
    </Link>
  );
}
export function ActionRow({ a, owner }: { a: LocalAction; owner?: string }) {
  const { t, lang } = useI18n();
  const open = !["completed", "verified", "cancelled"].includes(a.status);
  const due = dueText(a.dueAt, open, t);
  return (
    <Link to={`/a/${a.id}`} className={`list-item${a.local ? " local" : ""}`} data-row>
      <span className={`strip ${a.overdue && open ? "overdue" : `band-${a.band}`}`} />
      <span className="body">
        <span className="title clamp-2">{a.title}</span>
        <span className="meta">
          <span className="mono">{a.caseNo || t("common.pendingNumber")}</span>
          {a.sourceCaseNo ? <span>{t("action.from", { case: a.sourceCaseNo })}</span> : null}
          <span>{owner ?? a.ownerName}</span>
          {a.pendingRequest ? <Pill tone="amber">{t(`action.request.${a.pendingRequest}`)}</Pill> : null}
        </span>
        <span className={`small ${due.late ? "sla late" : due.soon ? "sla soon" : "muted"}`}>{open ? due.text : `${t("common.dueDate")}: ${due.text}`}{a.reopenCount ? ` · ${t("action.reopened", { count: a.reopenCount })}` : ""}</span>
      </span>
      <span className="aside">
        <ActionStatusChip status={a.status} overdue={a.overdue} />
        <BandPill band={a.band} />
        <span className="small muted">{relative(a.updatedAt, t, lang)}</span>
      </span>
    </Link>
  );
}
export function RunRow({ r, areaName, assetTag }: { r: LocalRun; areaName?: string; assetTag?: string }) {
  const { t, lang, pick } = useI18n();
  const due = r.dueAt ? dueText(r.dueAt, r.status === "scheduled" || r.status === "in_progress", t) : null;
  return (
    <Link to={`/inspections/runs/${r.id}`} className={`list-item${r.local ? " local" : ""}`} data-row>
      <span className={`strip ${r.status === "missed" || (due?.late && r.status === "scheduled") ? "overdue" : r.result === "fail" ? "band-extreme" : r.result === "pass" ? "band-low" : ""}`} />
      <span className="body">
        <span className="title">{pick(r.templateName)}</span>
        <span className="meta">
          <span className="mono">{r.caseNo || t("common.pendingNumber")}</span>
          {assetTag ? <span>{assetTag}</span> : areaName ? <span>{areaName}</span> : null}
          {r.inspectorName ? <span>{r.inspectorName}</span> : null}
          <span>{relative(r.completedAt ?? r.startedAt ?? r.dueAt ?? r.updatedAt, t, lang)}</span>
        </span>
        {due && (r.status === "scheduled" || r.status === "in_progress") ? <span className={`small ${due.late ? "sla late" : due.soon ? "sla soon" : "muted"}`}>{due.text}</span> : null}
      </span>
      <span className="aside">
        <RunStatusChip status={r.status} result={r.result} />
        {r.scorePct !== null ? <span className="small muted">{r.scorePct}% · {t("run.failedCount", { count: r.failedCount })}</span> : null}
        {r.actionsRaised ? <span className="small muted"><IconFlag size={12} /> {r.actionsRaised}</span> : null}
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------- list keyboard navigation (arrows / Enter) */
export function useListKeys(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        if (e.key === "ArrowDown") { const first = el.querySelector<HTMLElement>("[data-row]"); if (first) { e.preventDefault(); first.focus(); } }
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      const rows = [...el.querySelectorAll<HTMLElement>("[data-row]")];
      if (rows.length === 0) return;
      const idx = rows.findIndex((r) => r === document.activeElement);
      if (e.key === "Enter") { if (idx >= 0) { e.preventDefault(); rows[idx].click(); } return; }
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx - 1);
      rows[next].focus();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [containerRef]);
}

/* ---------------------------------------------------------------- search box ("/" focuses it) */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const fn = () => ref.current?.focus();
    document.addEventListener("sw:focus-search", fn);
    return () => document.removeEventListener("sw:focus-search", fn);
  }, []);
  return (
    <div className="search-row grow">
      <IconSearch size={18} style={{ color: "var(--muted)", flex: "none" }} />
      <input ref={ref} className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t("common.search")} aria-label={t("common.search")} />
    </div>
  );
}

/* ---------------------------------------------------------------- user select */
export function UserSelect({ users, value, onChange, allowEmpty, meId }: { users: { id: string; name: string; employeeCode?: string }[]; value: string | null; onChange: (id: string) => void; allowEmpty?: boolean; meId?: string | null }) {
  const { t } = useI18n();
  return (
    <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty || !value ? <option value="">{t("common.choose")}</option> : null}
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === meId ? ` (${t("common.you")})` : ""}{u.employeeCode ? ` · ${u.employeeCode}` : ""}</option>)}
    </Select>
  );
}

/* ---------------------------------------------------------------- language grid (four scripts) */
export function LangGrid({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang-grid" role="group" aria-label="Language">
      {LANGS.map((l) => <button key={l} type="button" lang={l} aria-pressed={value === l} onClick={() => onChange(l)}>{LANG_NAMES[l]}</button>)}
    </div>
  );
}

/* ---------------------------------------------------------------- header for sub-pages */
export function SubHead({ title, right, back, kicker }: { title: ReactNode; right?: ReactNode; back?: () => void; kicker?: ReactNode }) {
  const nav = useNavigate();
  const { t } = useI18n();
  return (
    <div className="page-head">
      <div className="row nowrap" style={{ gap: 4, minWidth: 0 }}>
        <Button variant="ghost" icon onClick={back ?? (() => nav(-1))} aria-label={t("common.back")}>‹</Button>
        <div style={{ minWidth: 0 }}>
          {kicker ? <div className="kicker">{kicker}</div> : null}
          <h1 style={{ fontSize: 22 }} className="truncate">{title}</h1>
        </div>
      </div>
      {right}
    </div>
  );
}

/* ---------------------------------------------------------------- "needs connection" hint for online-only actions */
export function useOnlineOnly(): { online: boolean; hint: string | undefined } {
  const { t } = useI18n();
  const { online } = useSync();
  return { online, hint: online ? undefined : t("common.needsConnection") };
}

export function useNow(ms = 30_000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return n;
}
