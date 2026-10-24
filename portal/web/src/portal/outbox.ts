// Offline queue: when the network drops while saving a point, the point (with its photos) is kept
// in IndexedDB on the phone and uploaded later. Each point carries its own UUID, so a retry never
// creates a duplicate on the server.
import { ApiError, type Api } from "../shared/api";

export interface QueuedPoint {
  id: string;
  data: Record<string, unknown>;
  photos: Blob[];
  after: Blob[];
  createdAt: number;
  attempts: number;
  lastError: string;
  failed: boolean;
  label: string;
}

const DB = "safeworks";
const STORE = "outbox";
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

const listeners = new Set<(n: number) => void>();
async function emit() {
  const n = await count().catch(() => 0);
  listeners.forEach((l) => l(n));
}

export function onOutbox(fn: (n: number) => void): () => void {
  listeners.add(fn);
  count().then(fn).catch(() => {});
  return () => listeners.delete(fn);
}

export async function enqueue(p: Omit<QueuedPoint, "createdAt" | "attempts" | "lastError" | "failed">): Promise<void> {
  await run("readwrite", (s) => s.put({ ...p, createdAt: Date.now(), attempts: 0, lastError: "", failed: false }));
  emit();
}

export async function list(): Promise<QueuedPoint[]> {
  try {
    return await run<QueuedPoint[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedPoint[]>);
  } catch {
    return [];
  }
}

export async function count(): Promise<number> {
  try {
    return await run<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

export async function remove(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
  emit();
}

export function toForm(data: Record<string, unknown>, photos: Blob[], after: Blob[]): FormData {
  const f = new FormData();
  f.append("data", JSON.stringify(data));
  photos.forEach((b, i) => f.append("photos", b, `photo-${i + 1}.jpg`));
  after.forEach((b, i) => f.append("afterPhotos", b, `after-${i + 1}.jpg`));
  return f;
}

let flushing = false;
/** Upload queued points. Returns how many were sent. */
export async function flush(api: Api): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const p of await list()) {
      if (p.failed) continue;
      try {
        await api.upload("/api/observations", toForm(p.data, p.photos, p.after));
        await remove(p.id);
        sent++;
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 0 || err.status >= 500 || err.status === 429) {
          await run("readwrite", (s) => s.put({ ...p, attempts: p.attempts + 1, lastError: err.message }));
          break; // still offline or server busy; try again later
        }
        // Rejected by the server (e.g. validation): keep it for the user to fix or discard.
        await run("readwrite", (s) => s.put({ ...p, attempts: p.attempts + 1, lastError: err.message, failed: true }));
      }
    }
  } finally {
    flushing = false;
    emit();
  }
  return sent;
}
