/* Sync engine (brief §13): push the outbox in seq order after dependencies, in batches of 50; upload media apart from
   text, one at a time, smallest first; pull incrementally with tombstones. Triggers: app start, `online`, tab becomes
   visible, every 2 minutes while online, and Sync now. Network and 5xx errors back off (5 s, 15 s, 1 min, 5 min, 15 min,
   then hourly with jitter); a 4xx marks the command Failed with the server's readable reason and never retries blindly. */
import { useSyncExternalStore } from "react";
import type { Me, SyncCommand, SyncPullResponse, SyncPushRequest, SyncPushResponse, SyncResult } from "../../shared/types";
import { ApiError } from "../../shared/api";
import { deviceId } from "../../shared/storage";
import { api, APP_VERSION } from "../api";
import {
  adoptServerId, allOutbox, getMeta, getMedia, getRef, mediaMeta, offlineReady, patchMedia, patchOutbox, patchOutboxMany, putNotifications, putRecords, putRef, setMeta,
  type OutboxItem, type RefData, invalidateRef,
} from "./db";

/* ---------------------------------------------------------------- state */
export interface SyncState {
  online: boolean;
  pending: number;
  failed: number;
  syncing: boolean;
  lastSyncedAt: string | null;
  uploads: { done: number; total: number };
  lastError: string | null;
}
let state: SyncState = { online: typeof navigator === "undefined" ? true : navigator.onLine, pending: 0, failed: 0, syncing: false, lastSyncedAt: null, uploads: { done: 0, total: 0 }, lastError: null };
const subs = new Set<() => void>();
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const fn of subs) fn();
}
export function getSyncState() { return state; }
export function useSync(): SyncState & { syncNow: () => Promise<void> } {
  const s = useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => state, () => state);
  return { ...s, syncNow };
}

/* ---------------------------------------------------------------- log (for diagnostics) */
export interface SyncLogEntry { at: string; level: "info" | "warn" | "error"; msg: string }
const log: SyncLogEntry[] = [];
function logit(level: SyncLogEntry["level"], msg: string) {
  log.push({ at: new Date().toISOString(), level, msg });
  if (log.length > 200) log.splice(0, log.length - 200);
  if (level === "error") console.warn("[safeworks sync]", msg);
}
export function syncLog(): SyncLogEntry[] { return [...log]; }

/* ---------------------------------------------------------------- hooks for the session */
type MeHandler = (me: Me) => void;
type OverridesHandler = (o: SyncPullResponse["translations"]) => void;
let onMe: MeHandler | null = null;
let onOverrides: OverridesHandler | null = null;
export function setSyncHandlers(h: { onMe?: MeHandler; onOverrides?: OverridesHandler }) {
  onMe = h.onMe ?? onMe;
  onOverrides = h.onOverrides ?? onOverrides;
}

/* ---------------------------------------------------------------- retry schedule */
const SCHEDULE_MS = [5_000, 15_000, 60_000, 300_000, 900_000];
export function nextDelay(attempts: number): number {
  const base = attempts < SCHEDULE_MS.length ? SCHEDULE_MS[attempts] : 3_600_000;
  const jitter = base * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}
function isRetryable(e: unknown): boolean {
  return e instanceof ApiError ? e.isNetwork || e.status >= 500 : true;
}
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ---------------------------------------------------------------- counts */
async function recount() {
  if (!offlineReady()) return;
  const items = await allOutbox();
  const pending = items.filter((x) => x.status === "pending" || x.status === "sending").length;
  const failed = items.filter((x) => x.status === "failed" || x.status === "conflict").length;
  const media = await mediaMeta();
  const live = media.filter((m) => m.status !== "failed");
  set({ pending, failed, uploads: { done: live.filter((m) => m.status === "uploaded").length, total: live.length } });
  // the retry schedule: wake up when the earliest backed-off command or upload is due again
  const due = [...items.filter((x) => x.status === "pending").map((x) => x.nextAttemptAt ?? 0), ...media.filter((m) => m.status === "queued" && m.uploadUrl).map((m) => m.nextAttemptAt ?? 0)].filter((t) => t > Date.now());
  if (due.length && !running) scheduleRetry(Math.min(...due) - Date.now());
}
let retryTimer = 0;
function scheduleRetry(ms: number) {
  clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => { if (navigator.onLine) void syncNow(); }, Math.max(500, ms) + 50);
}

/* ---------------------------------------------------------------- id resolution (§13.2) */
const ID_FIELDS = ["observationId", "actionId", "runId", "masterObservationId", "sourceId"] as const;
async function resolveIds(items: OutboxItem[]): Promise<SyncCommand[]> {
  const idmap = await getMeta<Record<string, string>>("idmap", {});
  return items.map((it) => {
    const payload = { ...(it.payload as Record<string, unknown>) };
    for (const f of ID_FIELDS) {
      const v = payload[f];
      if (typeof v === "string" && idmap[v]) payload[f] = idmap[v];
    }
    return {
      commandId: it.commandId, seq: it.seq, entityType: it.entityType, op: it.op, entityClientUuid: it.entityClientUuid,
      baseVersion: it.baseVersion, capturedAt: it.capturedAt, dependsOn: it.dependsOn.length ? it.dependsOn : undefined, payload,
    } as SyncCommand;
  });
}

/* ---------------------------------------------------------------- push */
async function applyResult(item: OutboxItem, r: SyncResult): Promise<void> {
  const now = new Date().toISOString();
  if (r.status === "applied" || r.status === "duplicate") {
    await patchOutbox(item.commandId, { status: "synced", syncedAt: now, serverId: r.serverId ?? item.serverId, caseNo: r.caseNo ?? item.caseNo, lastError: null, lastErrorCode: null, nextAttemptAt: null });
    if (r.serverId && (item.op === "create" || item.op === "start")) {
      const idmap = await getMeta<Record<string, string>>("idmap", {});
      idmap[item.entityClientUuid] = r.serverId;
      await setMeta("idmap", idmap);
      if (item.entityType === "observation") await adoptServerId("observations", item.entityClientUuid, r.serverId, r.caseNo ?? null);
      if (item.entityType === "inspection_run") await adoptServerId("runs", item.entityClientUuid, r.serverId, r.caseNo ?? null);
      if (item.entityType === "action") await adoptServerId("actions", item.entityClientUuid, r.serverId, r.caseNo ?? null);
    }
    for (const u of r.uploads ?? []) await patchMedia(u.clientUuid, { uploadUrl: u.url, status: "queued", nextAttemptAt: null });
    // media the server did not hand a URL for (e.g. duplicate replay) still needs one: fall back to PUT /media/{clientUuid}
    for (const mid of item.mediaUuids) {
      const m = await getMedia(mid);
      if (m && m.status === "waiting") await patchMedia(mid, { uploadUrl: `/media/${mid}`, status: "queued" });
    }
    logit("info", `${item.entityType}.${item.op} ${r.status}${r.caseNo ? ` → ${r.caseNo}` : ""}`);
  } else if (r.status === "rejected") {
    await patchOutbox(item.commandId, { status: "failed", lastError: r.error?.error ?? "Rejected by the server", lastErrorCode: r.error?.code ?? "rejected", nextAttemptAt: null });
    logit("warn", `${item.entityType}.${item.op} rejected: ${r.error?.code ?? ""} ${r.error?.error ?? ""}`);
  } else if (r.status === "conflict_saved_as_comment") {
    await patchOutbox(item.commandId, { status: "conflict", lastError: r.error?.error ?? null, lastErrorCode: "conflict", nextAttemptAt: null, syncedAt: now });
    logit("warn", `${item.entityType}.${item.op} conflict — saved as comment`);
  }
}

export async function push(): Promise<{ sent: number; ok: boolean }> {
  let sent = 0;
  for (let round = 0; round < 8; round++) {
    const all = await allOutbox();
    const synced = new Set(all.filter((x) => x.status === "synced").map((x) => x.commandId));
    const now = Date.now();
    const ready = all.filter((x) => x.status === "pending" && (x.nextAttemptAt === null || x.nextAttemptAt <= now) && x.dependsOn.every((d) => synced.has(d)));
    if (ready.length === 0) break;
    const batch = ready.slice(0, 50);
    await patchOutboxMany(batch.map((b) => ({ commandId: b.commandId, patch: { status: "sending" } })));
    const body: SyncPushRequest = { deviceId: deviceId(), appVersion: APP_VERSION, commands: await resolveIds(batch) };
    let res: SyncPushResponse;
    try {
      res = await api.post<SyncPushResponse>("/sync/push", body);
      set({ online: true, lastError: null });
    } catch (e) {
      const retry = isRetryable(e);
      const msg = errorText(e);
      await patchOutboxMany(batch.map((b) => ({ commandId: b.commandId, patch: retry
        ? { status: "pending", attempts: b.attempts + 1, nextAttemptAt: Date.now() + nextDelay(b.attempts), lastError: msg }
        : { status: "failed", attempts: b.attempts + 1, nextAttemptAt: null, lastError: msg, lastErrorCode: e instanceof ApiError ? e.code : "error" } })));
      if (e instanceof ApiError && e.isNetwork) set({ online: false });
      set({ lastError: msg });
      logit(retry ? "warn" : "error", `push failed (${batch.length}): ${msg}`);
      await recount();
      return { sent, ok: false };
    }
    const byId = new Map(res.results.map((r) => [r.commandId, r]));
    for (const item of batch) {
      const r = byId.get(item.commandId);
      if (r) await applyResult(item, r);
      else await patchOutbox(item.commandId, { status: "pending", attempts: item.attempts + 1, nextAttemptAt: Date.now() + nextDelay(item.attempts), lastError: "No result returned for this command" });
    }
    sent += batch.length;
    await recount();
  }
  return { sent, ok: true };
}

/* ---------------------------------------------------------------- media uploads (§13.7) */
let uploading = false;
export async function uploadMedia(): Promise<void> {
  if (uploading) return;
  uploading = true;
  try {
    for (let n = 0; n < 200; n++) {
      const metas = await mediaMeta();
      const now = Date.now();
      const due = metas
        .filter((m) => m.uploadUrl && (m.status === "queued" || (m.status === "uploading")) && (m.nextAttemptAt === null || m.nextAttemptAt <= now))
        .sort((a, b) => a.ref.bytes - b.ref.bytes);
      const next = due[0];
      if (!next) break;
      const full = await getMedia(next.clientUuid);
      if (!full || !full.blob) {
        await patchMedia(next.clientUuid, { status: "failed", lastError: "Photo bytes are missing on this device", nextAttemptAt: null });
        continue;
      }
      await patchMedia(next.clientUuid, { status: "uploading" });
      try {
        await api.putBytes(full.uploadUrl!, full.blob, full.ref.mime);
        await patchMedia(next.clientUuid, { status: "uploaded", lastError: null, nextAttemptAt: null, dropBlob: true });
        logit("info", `media ${next.ref.kind} ${Math.round(next.ref.bytes / 1024)} KB uploaded`);
        set({ online: true });
      } catch (e) {
        const msg = errorText(e);
        if (isRetryable(e)) {
          await patchMedia(next.clientUuid, { status: "queued", attempts: next.attempts + 1, nextAttemptAt: Date.now() + nextDelay(next.attempts), lastError: msg });
          if (e instanceof ApiError && e.isNetwork) set({ online: false });
          logit("warn", `media upload deferred: ${msg}`);
          break; // the network is down or the server is unwell; do not hammer it
        }
        await patchMedia(next.clientUuid, { status: "failed", attempts: next.attempts + 1, nextAttemptAt: null, lastError: msg });
        logit("error", `media upload rejected: ${msg}`);
      }
      await recount();
    }
  } finally {
    uploading = false;
    await recount();
  }
}

/* ---------------------------------------------------------------- pull (§13.9) */
export async function pull(force = false): Promise<SyncPullResponse | null> {
  const cursor = force ? "" : await getMeta<string>("cursor", "");
  let res: SyncPullResponse;
  try {
    res = await api.get<SyncPullResponse>("/sync/pull", { cursor, deviceId: deviceId() });
    set({ online: true, lastError: null });
  } catch (e) {
    if (e instanceof ApiError && e.isNetwork) set({ online: false });
    set({ lastError: errorText(e) });
    logit("warn", `pull failed: ${errorText(e)}`);
    return null;
  }
  const full = !!res.full;
  const deleted = (res.deleted ?? []).reduce<Record<string, string[]>>((acc, t) => { (acc[t.entityType] ??= []).push(t.id); return acc; }, {});
  await putRef({
    ...(full || res.sites?.length ? { sites: mergeById(full ? [] : (await refOf("sites")), res.sites) } : {}),
    ...(full || res.areas?.length ? { areas: mergeById(full ? [] : await refOf("areas"), res.areas, deleted.area) } : {}),
    ...(full || res.assets?.length ? { assets: mergeById(full ? [] : await refOf("assets"), res.assets, deleted.asset) } : {}),
    ...(full || res.categories?.length ? { categories: mergeById(full ? [] : await refOf("categories"), res.categories, deleted.category) } : {}),
    ...(full || res.contractors?.length ? { contractors: mergeById(full ? [] : await refOf("contractors"), res.contractors, deleted.contractor) } : {}),
    ...(full || res.directory?.length ? { directory: mergeById(full ? [] : await refOf("directory"), res.directory, deleted.user) } : {}),
    ...(full || res.matrixVersions?.length ? { matrixVersions: mergeById(full ? [] : await refOf("matrixVersions"), res.matrixVersions) } : {}),
    ...(full || res.dueDateRules?.length ? { dueDateRules: full ? res.dueDateRules : mergeById(await refOf("dueDateRules"), res.dueDateRules) } : {}),
    ...(full || res.ladders?.length ? { ladders: full ? res.ladders : mergeById(await refOf("ladders"), res.ladders) } : {}),
    ...(full || res.industries?.length ? { industries: full ? res.industries : mergeBy(await refOf("industries"), res.industries, (x) => x.code) } : {}),
    ...(full || res.templates?.length ? { templates: mergeById(full ? [] : await refOf("templates"), res.templates, deleted.template_version) } : {}),
    ...(full || res.schedules?.length ? { schedules: mergeById(full ? [] : await refOf("schedules"), res.schedules, deleted.schedule) } : {}),
    ...(res.translations ? { translations: res.translations } : {}),
    ...(res.privacyNotice !== undefined ? { privacyNotice: res.privacyNotice } : {}),
  });
  await putRecords("observations", res.observations ?? [], { replaceAll: full, deleteIds: deleted.observation });
  await putRecords("actions", res.actions ?? [], { replaceAll: full, deleteIds: deleted.action });
  await putRecords("runs", res.runs ?? [], { replaceAll: full, deleteIds: deleted.inspection_run });
  await putNotifications(res.notifications ?? [], full);
  await setMeta("cursor", res.cursor);
  const at = res.serverTime || new Date().toISOString();
  await setMeta("lastSyncedAt", at);
  await setMeta("serverSkewMs", new Date(res.serverTime).getTime() - Date.now());
  if (res.me) { await setMeta("me", res.me); onMe?.(res.me); }
  if (res.translations) onOverrides?.(res.translations);
  invalidateRef();
  set({ lastSyncedAt: at });
  logit("info", `pull ${full ? "full" : "incremental"}: ${res.observations?.length ?? 0} obs, ${res.actions?.length ?? 0} actions, ${res.runs?.length ?? 0} runs`);
  return res;
}
async function refOf<K extends keyof RefData>(k: K): Promise<RefData[K]> { return (await getRef())[k]; }
function mergeById<T extends { id: string }>(prev: T[], next: T[] | undefined, tombstones?: string[]): T[] {
  return mergeBy(prev, next, (x) => x.id, tombstones);
}
function mergeBy<T>(prev: T[], next: T[] | undefined, key: (x: T) => string, tombstones?: string[]): T[] {
  const map = new Map(prev.map((x) => [key(x), x]));
  for (const n of next ?? []) map.set(key(n), n);
  for (const t of tombstones ?? []) map.delete(t);
  return [...map.values()];
}

/* ---------------------------------------------------------------- orchestration */
let running: Promise<void> | null = null;
let again = false;
let timer = 0;
let kickTimer = 0;
export async function syncNow(): Promise<void> {
  if (running) { again = true; return running; } // something was queued mid-sync: run once more when this one ends
  if (!offlineReady() || !api.token()) return;
  running = (async () => {
    set({ syncing: true });
    try {
      await recount();
      const p = await push();
      if (p.ok) await uploadMedia();
      if (p.ok || navigator.onLine) await pull();
    } catch (e) {
      logit("error", `sync crashed: ${errorText(e)}`);
      set({ lastError: errorText(e) });
    } finally {
      await recount();
      set({ syncing: false });
      running = null;
      if (again) { again = false; void syncNow(); }
    }
  })();
  return running;
}
/** Push soon (debounced) — called after every enqueue so a saved report leaves the phone within a second when online. */
export function kick(delayMs = 400) {
  void recount(); // the banner shows the new pending item at once, before the push runs
  clearTimeout(kickTimer);
  kickTimer = window.setTimeout(() => { void syncNow(); }, delayMs);
}
let started = false;
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  const last = await getMeta<string | null>("lastSyncedAt", null);
  set({ lastSyncedAt: last });
  await recount();
  const onOnline = () => { set({ online: true }); kick(200); };
  const onOffline = () => set({ online: false });
  const onVisible = () => { if (document.visibilityState === "visible") kick(300); };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  timer = window.setInterval(() => { if (navigator.onLine) void syncNow(); }, 120_000);
  kick(50);
}
export function stopSync() {
  started = false;
  clearInterval(timer);
  clearTimeout(kickTimer);
  clearTimeout(retryTimer);
}
/** Flip failed items back to pending and sync. */
export async function retryFailed(commandIds?: string[]) {
  const items = await allOutbox();
  const targets = items.filter((x) => (x.status === "failed") && (!commandIds || commandIds.includes(x.commandId)));
  await patchOutboxMany(targets.map((t) => ({ commandId: t.commandId, patch: { status: "pending", nextAttemptAt: null, lastError: null, lastErrorCode: null } })));
  const metas = await mediaMeta();
  for (const m of metas) if (m.status === "failed" && (!commandIds || commandIds.includes(m.commandId))) await patchMedia(m.clientUuid, { status: m.uploadUrl ? "queued" : "waiting", nextAttemptAt: null, lastError: null });
  await recount();
  void syncNow();
}
