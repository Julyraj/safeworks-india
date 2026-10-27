/* The QR form's tiny offline queue: reports typed after the page loaded but before the network came back are kept in
   IndexedDB (keyed by token) with their photo bytes and sent when the browser is online again. */
import { openDB, type DBSchema } from "idb";
import type { MediaRef, QrInfo, QrObservationCreate } from "../shared/types";

export interface QueuedReport { clientUuid: string; token: string; payload: QrObservationCreate; blobs: { ref: MediaRef; blob: Blob }[]; createdAt: string; attempts: number; lastError: string | null; caseNo: string | null; statusUrl: string | null; uploaded: string[] }
interface QrDB extends DBSchema {
  queue: { key: string; value: QueuedReport; indexes: { byToken: string } };
  info: { key: string; value: { token: string; info: QrInfo; at: string } };
}
const dbp = typeof indexedDB === "undefined" ? null : openDB<QrDB>("sw-qr", 1, {
  upgrade(d) {
    d.createObjectStore("queue", { keyPath: "clientUuid" }).createIndex("byToken", "token");
    d.createObjectStore("info", { keyPath: "token" });
  },
});
export async function cacheInfo(token: string, info: QrInfo) { try { await (await dbp)?.put("info", { token, info, at: new Date().toISOString() }); } catch { /* storage unavailable */ } }
export async function cachedInfo(token: string): Promise<QrInfo | null> { try { return (await (await dbp)?.get("info", token))?.info ?? null; } catch { return null; } }
export async function enqueueReport(r: QueuedReport) { await (await dbp)?.put("queue", r); }
export async function updateReport(clientUuid: string, patch: Partial<QueuedReport>) {
  const db = await dbp; if (!db) return;
  const r = await db.get("queue", clientUuid);
  if (r) await db.put("queue", { ...r, ...patch });
}
export async function queued(token: string): Promise<QueuedReport[]> { try { return (await (await dbp)?.getAllFromIndex("queue", "byToken", token)) ?? []; } catch { return []; } }
export async function removeReport(clientUuid: string) { await (await dbp)?.delete("queue", clientUuid); }
