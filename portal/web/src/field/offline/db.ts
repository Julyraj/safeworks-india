/* Local-first storage for the field app (brief §13).
   One IndexedDB database per signed-in user (`sw-field-<userId>`) so a shared phone keeps every user's
   records, drafts and outbox apart. Everything the user typed or photographed (outbox payloads, drafts, photo
   bytes, cached detail screens) is sealed with a non-extractable AES-GCM key kept in IndexedDB (WebCrypto);
   the pulled list caches stay plain so they can be indexed. Every write to a record and its outbox command
   happens in one IndexedDB transaction, so a crash never leaves a record without its command or vice versa. */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  ActionSummary, Area, Asset, Category, Contractor, DirectoryUser, DueDateRule, IndustryProfile, MediaRef, Notification, ObservationSummary,
  ReminderLadder, RiskMatrixVersion, RunSummary, Schedule, Site, SyncOp, TemplateVersion, Lang,
} from "../../shared/types";

/* ---------------------------------------------------------------- types */
export type OutboxStatus = "draft" | "pending" | "sending" | "synced" | "failed" | "conflict";

export interface OutboxItem {
  commandId: string;
  seq: number;
  entityType: SyncOp["entityType"];
  entityClientUuid: string;
  op: SyncOp["op"];
  payload: unknown;
  baseVersion: number | null;
  capturedAt: string;
  deviceId: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number | null; // epoch ms; null = no automatic retry
  lastError: string | null;
  lastErrorCode: string | null;
  dependsOn: string[];
  /* display and bookkeeping */
  title: string;
  targetId: string; // the record this command acts on (server id or client uuid)
  createdAt: string;
  syncedAt: string | null;
  serverId: string | null;
  caseNo: string | null;
  mediaUuids: string[];
  fixRoute: string | null; // where "Fix and resend" opens
}
type StoredOutbox = Omit<OutboxItem, "payload"> & { sealed: Sealed };

export type MediaStatus = "waiting" | "queued" | "uploading" | "uploaded" | "failed";
export interface MediaItem {
  clientUuid: string;
  ref: MediaRef;
  blob: Blob | null; // null once uploaded (bytes dropped to save space)
  uploadUrl: string | null;
  status: MediaStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  commandId: string;
  ownerClientUuid: string;
  createdAt: string;
}
type StoredMedia = Omit<MediaItem, "blob"> & { sealed: Sealed | null };

export interface DraftRow<T = unknown> { key: string; value: T; updatedAt: string }
type StoredDraft = { key: string; sealed: Sealed; updatedAt: string };
export interface DetailRow<T = unknown> { key: string; value: T; fetchedAt: string }
type StoredDetail = { key: string; sealed: Sealed; fetchedAt: string };

export type LocalObservation = ObservationSummary & { local?: boolean; commandId?: string };
export type LocalAction = ActionSummary & { local?: boolean; commandId?: string };
export type LocalRun = RunSummary & { local?: boolean; commandId?: string };

export interface RefData {
  sites: Site[]; areas: Area[]; assets: Asset[]; categories: Category[]; contractors: Contractor[]; directory: DirectoryUser[];
  matrixVersions: RiskMatrixVersion[]; dueDateRules: DueDateRule[]; ladders: ReminderLadder[]; industries: IndustryProfile[];
  templates: TemplateVersion[]; schedules: Schedule[]; translations: Partial<Record<Lang, Record<string, string>>>;
  privacyNotice: { version: number; body: Record<string, string>; effectiveFrom: string } | null;
}
export const EMPTY_REF: RefData = {
  sites: [], areas: [], assets: [], categories: [], contractors: [], directory: [], matrixVersions: [], dueDateRules: [], ladders: [],
  industries: [], templates: [], schedules: [], translations: {}, privacyNotice: null,
};
export type RefKey = keyof RefData;

interface FieldDB extends DBSchema {
  meta: { key: string; value: unknown };
  ref: { key: string; value: unknown };
  observations: { key: string; value: LocalObservation; indexes: { byClientUuid: string } };
  actions: { key: string; value: LocalAction; indexes: { byClientUuid: string } };
  runs: { key: string; value: LocalRun; indexes: { byClientUuid: string } };
  notifications: { key: number; value: Notification };
  outbox: { key: string; value: StoredOutbox; indexes: { bySeq: number; byStatus: string } };
  media: { key: string; value: StoredMedia; indexes: { byStatus: string; byCommand: string } };
  drafts: { key: string; value: StoredDraft };
  details: { key: string; value: StoredDetail };
}

/* ---------------------------------------------------------------- change events */
export type StoreName = "meta" | "ref" | "observations" | "actions" | "runs" | "notifications" | "outbox" | "media" | "drafts" | "details";
type Listener = () => void;
const listeners = new Map<StoreName, Set<Listener>>();
export function onStore(stores: StoreName[], fn: Listener): () => void {
  for (const s of stores) {
    if (!listeners.has(s)) listeners.set(s, new Set());
    listeners.get(s)!.add(fn);
  }
  return () => { for (const s of stores) listeners.get(s)?.delete(fn); };
}
export function emit(...stores: StoreName[]) {
  const fired = new Set<Listener>();
  for (const s of stores) for (const fn of listeners.get(s) ?? []) if (!fired.has(fn)) { fired.add(fn); try { fn(); } catch (e) { console.error("[safeworks] store listener failed", e); } }
}

/* ---------------------------------------------------------------- vault (encryption at rest) */
export type Sealed = { v: 1; iv: ArrayBuffer; data: ArrayBuffer } | { v: 0; plain: unknown };
let keyPromise: Promise<CryptoKey | null> | null = null;
async function vaultKey(): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    if (!globalThis.crypto?.subtle || typeof indexedDB === "undefined") return null;
    try {
      const kdb = await openDB("sw-field-keys", 1, { upgrade(d) { d.createObjectStore("keys"); } });
      let key = (await kdb.get("keys", "k1")) as CryptoKey | undefined;
      if (!key) {
        key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await kdb.put("keys", key, "k1");
      }
      kdb.close();
      return key;
    } catch (e) {
      console.warn("[safeworks] vault unavailable, storing plain", e);
      return null;
    }
  })();
  return keyPromise;
}
const enc = new TextEncoder();
const dec = new TextDecoder();
export async function seal(value: unknown): Promise<Sealed> {
  const key = await vaultKey();
  if (!key) return { v: 0, plain: value };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = value instanceof ArrayBuffer ? value : enc.encode(JSON.stringify(value)).buffer as ArrayBuffer;
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { v: 1, iv: iv.buffer as ArrayBuffer, data };
}
export async function unseal<T>(s: Sealed, raw = false): Promise<T> {
  if (s.v === 0) return s.plain as T;
  const key = await vaultKey();
  if (!key) throw new Error("vault_locked");
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(s.iv) }, key, s.data);
  if (raw) return bytes as T;
  return JSON.parse(dec.decode(bytes)) as T;
}

/* ---------------------------------------------------------------- open / close */
let db: IDBPDatabase<FieldDB> | null = null;
let currentUid: string | null = null;
let opening: Promise<IDBPDatabase<FieldDB>> | null = null;

export function dbName(uid: string) { return `sw-field-${uid}`; }

export async function initOffline(uid: string): Promise<void> {
  if (db && currentUid === uid) return;
  if (db) { db.close(); db = null; }
  currentUid = uid;
  opening = openDB<FieldDB>(dbName(uid), 1, {
    upgrade(d) {
      d.createObjectStore("meta");
      d.createObjectStore("ref");
      d.createObjectStore("observations", { keyPath: "id" }).createIndex("byClientUuid", "clientUuid");
      d.createObjectStore("actions", { keyPath: "id" }).createIndex("byClientUuid", "clientUuid");
      d.createObjectStore("runs", { keyPath: "id" }).createIndex("byClientUuid", "clientUuid");
      d.createObjectStore("notifications", { keyPath: "id" });
      const ob = d.createObjectStore("outbox", { keyPath: "commandId" });
      ob.createIndex("bySeq", "seq");
      ob.createIndex("byStatus", "status");
      const md = d.createObjectStore("media", { keyPath: "clientUuid" });
      md.createIndex("byStatus", "status");
      md.createIndex("byCommand", "commandId");
      d.createObjectStore("drafts", { keyPath: "key" });
      d.createObjectStore("details", { keyPath: "key" });
    },
    blocking() { db?.close(); db = null; },
  });
  db = await opening;
  opening = null;
  try { if (navigator.storage?.persist) void navigator.storage.persist(); } catch { /* not supported */ }
  await vaultKey();
  emit("meta", "ref", "observations", "actions", "runs", "notifications", "outbox", "media", "drafts", "details");
}
export function closeOffline() { db?.close(); db = null; currentUid = null; }
export function offlineUid() { return currentUid; }
async function d(): Promise<IDBPDatabase<FieldDB>> {
  if (db) return db;
  if (opening) return opening;
  throw new Error("offline store not initialised");
}
export function offlineReady() { return !!db; }

/* ---------------------------------------------------------------- meta */
export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const v = (await (await d()).get("meta", key)) as T | undefined;
  return v === undefined ? fallback : v;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await d()).put("meta", value, key);
  emit("meta");
}

/* ---------------------------------------------------------------- reference data */
let refCache: RefData | null = null;
export async function getRef(): Promise<RefData> {
  if (refCache) return refCache;
  const tx = (await d()).transaction("ref");
  const out: RefData = { ...EMPTY_REF };
  for (const k of Object.keys(EMPTY_REF) as RefKey[]) {
    const v = await tx.store.get(k);
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  refCache = out;
  return out;
}
export async function putRef(partial: Partial<RefData>): Promise<void> {
  const tx = (await d()).transaction("ref", "readwrite");
  for (const [k, v] of Object.entries(partial)) await tx.store.put(v, k);
  await tx.done;
  refCache = null;
  emit("ref");
}
export function invalidateRef() { refCache = null; }

/* ---------------------------------------------------------------- records */
type RecordStore = "observations" | "actions" | "runs";
export async function allRecords<T extends RecordStore>(store: T): Promise<FieldDB[T]["value"][]> {
  return (await d()).getAll(store) as Promise<FieldDB[T]["value"][]>;
}
export async function getRecord<T extends RecordStore>(store: T, id: string): Promise<FieldDB[T]["value"] | undefined> {
  const database = await d();
  const direct = await database.get(store, id);
  if (direct) return direct as FieldDB[T]["value"];
  return (await database.getFromIndex(store, "byClientUuid", id)) as FieldDB[T]["value"] | undefined;
}
export async function putRecords<T extends RecordStore>(store: T, rows: FieldDB[T]["value"][], opts: { replaceAll?: boolean; deleteIds?: string[] } = {}): Promise<void> {
  const database = await d();
  const tx = database.transaction(store, "readwrite");
  if (opts.replaceAll) {
    // keep local (not yet synced) records; everything else is the server's to replace
    let cur = await tx.store.openCursor();
    while (cur) {
      if (!(cur.value as { local?: boolean }).local) await cur.delete();
      cur = await cur.continue();
    }
  }
  for (const id of opts.deleteIds ?? []) await tx.store.delete(id);
  for (const r of rows) {
    // a server copy replaces the local placeholder with the same clientUuid
    const local = await tx.store.index("byClientUuid").get(r.clientUuid);
    if (local && local.id !== r.id) await tx.store.delete(local.id);
    await tx.store.put(r as never);
  }
  await tx.done;
  emit(store);
}
export async function deleteRecord(store: RecordStore, id: string): Promise<void> {
  await (await d()).delete(store, id);
  emit(store);
}

export async function allNotifications(): Promise<Notification[]> {
  const rows = await (await d()).getAll("notifications");
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function putNotifications(rows: Notification[], replaceAll = false): Promise<void> {
  const tx = (await d()).transaction("notifications", "readwrite");
  if (replaceAll) await tx.store.clear();
  for (const r of rows) await tx.store.put(r);
  await tx.done;
  emit("notifications");
}
export async function patchNotification(id: number, patch: Partial<Notification>): Promise<void> {
  const database = await d();
  const n = await database.get("notifications", id);
  if (n) { await database.put("notifications", { ...n, ...patch }); emit("notifications"); }
}

/* ---------------------------------------------------------------- outbox */
async function fromStoredOutbox(s: StoredOutbox): Promise<OutboxItem> {
  const { sealed, ...rest } = s;
  return { ...rest, payload: await unseal(sealed) };
}
export async function allOutbox(): Promise<OutboxItem[]> {
  const rows = await (await d()).getAllFromIndex("outbox", "bySeq");
  return Promise.all(rows.map(fromStoredOutbox));
}
export async function getOutbox(commandId: string): Promise<OutboxItem | undefined> {
  const s = await (await d()).get("outbox", commandId);
  return s ? fromStoredOutbox(s) : undefined;
}
export async function patchOutbox(commandId: string, patch: Partial<OutboxItem>): Promise<void> {
  const database = await d();
  const s = await database.get("outbox", commandId);
  if (!s) return;
  const { payload, ...rest } = patch;
  const next: StoredOutbox = { ...s, ...rest };
  if (payload !== undefined) next.sealed = await seal(payload);
  await database.put("outbox", next);
  emit("outbox");
}
export async function patchOutboxMany(patches: { commandId: string; patch: Partial<Omit<OutboxItem, "payload">> }[]): Promise<void> {
  const tx = (await d()).transaction("outbox", "readwrite");
  for (const { commandId, patch } of patches) {
    const s = await tx.store.get(commandId);
    if (s) await tx.store.put({ ...s, ...patch });
  }
  await tx.done;
  emit("outbox");
}
export async function deleteOutbox(commandIds: string[]): Promise<void> {
  const tx = (await d()).transaction(["outbox", "media"], "readwrite");
  for (const id of commandIds) {
    await tx.objectStore("outbox").delete(id);
    const media = await tx.objectStore("media").index("byCommand").getAllKeys(id);
    for (const m of media) await tx.objectStore("media").delete(m);
  }
  await tx.done;
  emit("outbox", "media");
}

/* ---------------------------------------------------------------- media */
async function fromStoredMedia(s: StoredMedia): Promise<MediaItem> {
  const { sealed, ...rest } = s;
  let blob: Blob | null = null;
  if (sealed) {
    if (sealed.v === 0) blob = sealed.plain as Blob;
    else blob = new Blob([await unseal<ArrayBuffer>(sealed, true)], { type: rest.ref.mime });
  }
  return { ...rest, blob };
}
export async function allMedia(): Promise<MediaItem[]> {
  const rows = await (await d()).getAll("media");
  return Promise.all(rows.map(fromStoredMedia));
}
export async function mediaMeta(): Promise<Omit<MediaItem, "blob">[]> {
  const rows = await (await d()).getAll("media");
  return rows.map(({ sealed, ...rest }) => rest);
}
export async function getMedia(clientUuid: string): Promise<MediaItem | undefined> {
  const s = await (await d()).get("media", clientUuid);
  return s ? fromStoredMedia(s) : undefined;
}
export async function patchMedia(clientUuid: string, patch: Partial<Omit<MediaItem, "blob">> & { dropBlob?: boolean }): Promise<void> {
  const database = await d();
  const s = await database.get("media", clientUuid);
  if (!s) return;
  const { dropBlob, ...rest } = patch;
  await database.put("media", { ...s, ...rest, sealed: dropBlob ? null : s.sealed });
  emit("media");
}
async function sealBlob(blob: Blob): Promise<Sealed> {
  const key = await vaultKey();
  if (!key) return { v: 0, plain: blob };
  return seal(await blob.arrayBuffer());
}

/* ---------------------------------------------------------------- drafts & detail cache */
export async function getDraft<T>(key: string): Promise<DraftRow<T> | null> {
  const s = await (await d()).get("drafts", key);
  if (!s) return null;
  try { return { key, value: await unseal<T>(s.sealed), updatedAt: s.updatedAt }; } catch { return null; }
}
export async function putDraft<T>(key: string, value: T): Promise<void> {
  const sealed = await seal(value);
  await (await d()).put("drafts", { key, sealed, updatedAt: new Date().toISOString() });
  emit("drafts");
}
export async function deleteDraft(key: string): Promise<void> {
  await (await d()).delete("drafts", key);
  emit("drafts");
}
export async function listDraftKeys(): Promise<string[]> {
  return (await (await d()).getAllKeys("drafts")) as string[];
}
export async function getDetail<T>(key: string): Promise<DetailRow<T> | null> {
  const s = await (await d()).get("details", key);
  if (!s) return null;
  try { return { key, value: await unseal<T>(s.sealed), fetchedAt: s.fetchedAt }; } catch { return null; }
}
export async function putDetail<T>(key: string, value: T): Promise<void> {
  const sealed = await seal(value);
  await (await d()).put("details", { key, sealed, fetchedAt: new Date().toISOString() });
  emit("details");
}

/* ---------------------------------------------------------------- the one local transaction (§13.1) */
export interface EnqueueInput {
  commandId: string;
  entityType: SyncOp["entityType"];
  op: SyncOp["op"];
  entityClientUuid: string;
  payload: unknown;
  baseVersion?: number | null;
  capturedAt: string;
  deviceId: string;
  dependsOn?: string[];
  title: string;
  targetId: string;
  fixRoute?: string | null;
  media?: { ref: MediaRef; blob: Blob }[];
  /** local placeholder records written in the same transaction */
  observation?: LocalObservation;
  run?: LocalRun;
  action?: LocalAction;
  status?: OutboxStatus;
}
/** Writes the command, its media bytes and any placeholder record atomically and returns the item. */
export async function enqueue(input: EnqueueInput): Promise<OutboxItem> {
  const database = await d();
  const sealedPayload = await seal(input.payload);
  const sealedMedia: StoredMedia[] = [];
  const now = new Date().toISOString();
  for (const m of input.media ?? []) {
    sealedMedia.push({
      clientUuid: m.ref.clientUuid, ref: m.ref, sealed: await sealBlob(m.blob), uploadUrl: null, status: "waiting", attempts: 0, nextAttemptAt: null, lastError: null,
      commandId: input.commandId, ownerClientUuid: input.entityClientUuid, createdAt: now,
    });
  }
  const tx = database.transaction(["meta", "outbox", "media", "observations", "runs", "actions"], "readwrite");
  const seq = ((await tx.objectStore("meta").get("seq")) as number | undefined ?? 0) + 1;
  await tx.objectStore("meta").put(seq, "seq");
  const stored: StoredOutbox = {
    commandId: input.commandId, seq, entityType: input.entityType, entityClientUuid: input.entityClientUuid, op: input.op, sealed: sealedPayload,
    baseVersion: input.baseVersion ?? null, capturedAt: input.capturedAt, deviceId: input.deviceId, status: input.status ?? "pending", attempts: 0, nextAttemptAt: null,
    lastError: null, lastErrorCode: null, dependsOn: input.dependsOn ?? [], title: input.title, targetId: input.targetId, createdAt: now, syncedAt: null, serverId: null,
    caseNo: null, mediaUuids: sealedMedia.map((m) => m.clientUuid), fixRoute: input.fixRoute ?? null,
  };
  await tx.objectStore("outbox").put(stored);
  for (const m of sealedMedia) await tx.objectStore("media").put(m);
  if (input.observation) await tx.objectStore("observations").put(input.observation);
  if (input.run) await tx.objectStore("runs").put(input.run);
  if (input.action) await tx.objectStore("actions").put(input.action);
  await tx.done;
  emit("outbox", "media", "meta", ...(input.observation ? ["observations" as const] : []), ...(input.run ? ["runs" as const] : []), ...(input.action ? ["actions" as const] : []));
  const { sealed, ...rest } = stored;
  return { ...rest, payload: input.payload };
}

/** Re-keys a local placeholder record once the server has assigned its id and case number. */
export async function adoptServerId(store: RecordStore, clientUuid: string, serverId: string, caseNo: string | null): Promise<void> {
  const database = await d();
  const tx = database.transaction(store, "readwrite");
  const local = await tx.store.index("byClientUuid").get(clientUuid);
  if (local) {
    if (local.id !== serverId) await tx.store.delete(local.id);
    await tx.store.put({ ...local, id: serverId, caseNo: caseNo ?? local.caseNo } as never);
  }
  await tx.done;
  emit(store);
}

/** Wipes this user's database (logout after everything synced). */
export async function wipeUserData(uid: string): Promise<void> {
  if (db && currentUid === uid) { db.close(); db = null; currentUid = null; }
  refCache = null;
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase(dbName(uid));
    req.onsuccess = () => res();
    req.onerror = () => res();
    req.onblocked = () => res();
  });
}

/** Rough size of what is stored, for the diagnostics export. */
export async function storageEstimate(): Promise<{ usageMB: number | null; quotaMB: number | null }> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usageMB: e?.usage ? Math.round((e.usage / 1048576) * 10) / 10 : null, quotaMB: e?.quota ? Math.round(e.quota / 1048576) : null };
  } catch { return { usageMB: null, quotaMB: null }; }
}
