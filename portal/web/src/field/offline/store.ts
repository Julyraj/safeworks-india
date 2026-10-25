/* React hooks over the local store: every screen reads from IndexedDB first (instant, works offline) and re-reads
   when the store changes (after a pull, a push result or a new command). */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Notification } from "../../shared/types";
import {
  allMedia, allNotifications, allOutbox, allRecords, EMPTY_REF, getDetail, getDraft, getRef, mediaMeta, offlineReady, onStore, putDetail, putDraft, deleteDraft,
  type LocalAction, type LocalObservation, type LocalRun, type MediaItem, type OutboxItem, type RefData, type StoreName,
} from "./db";
import { api } from "../api";
import { ApiError } from "../../shared/api";
import { getSyncState } from "./sync";

/** Reads `reader()` now and again whenever one of `stores` changes. */
export function useStore<T>(reader: () => Promise<T>, stores: StoreName[], initial: T, deps: unknown[] = []): { data: T; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  const alive = useRef(true);
  const readerRef = useRef(reader);
  readerRef.current = reader;
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const run = () => {
      if (!offlineReady()) { setLoading(false); return; }
      readerRef.current().then((d) => { if (!cancelled && alive.current) { setData(d); setLoading(false); } }, (e) => { console.error("[safeworks] store read failed", e); if (!cancelled) setLoading(false); });
    };
    run();
    const off = onStore(stores, run);
    return () => { cancelled = true; alive.current = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, ...deps]);
  return { data, loading, reload: () => setN((x) => x + 1) };
}

export function useRefData(): RefData {
  return useStore(getRef, ["ref"], EMPTY_REF).data;
}
export function useObservations(): { data: LocalObservation[]; loading: boolean } {
  return useStore(() => allRecords("observations"), ["observations"], [] as LocalObservation[]);
}
export function useActions(): { data: LocalAction[]; loading: boolean } {
  return useStore(() => allRecords("actions"), ["actions"], [] as LocalAction[]);
}
export function useRuns(): { data: LocalRun[]; loading: boolean } {
  return useStore(() => allRecords("runs"), ["runs"], [] as LocalRun[]);
}
export function useNotifications(): { data: Notification[]; loading: boolean } {
  return useStore(allNotifications, ["notifications"], [] as Notification[]);
}
export function useOutbox(): { data: OutboxItem[]; loading: boolean } {
  return useStore(allOutbox, ["outbox"], [] as OutboxItem[]);
}
export function useMediaMeta(): Omit<MediaItem, "blob">[] {
  return useStore(mediaMeta, ["media"], [] as Omit<MediaItem, "blob">[]).data;
}
/** Media with bytes — only for previews of local photos (object URLs are revoked on unmount). */
export function useLocalMediaPreviews(clientUuids: string[]): Record<string, string> {
  const key = clientUuids.join("|");
  const { data } = useStore(async () => (await allMedia()).filter((m) => clientUuids.includes(m.clientUuid) && m.blob), ["media"], [] as MediaItem[], [key]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const m of data) if (m.blob) next[m.clientUuid] = URL.createObjectURL(m.blob);
    setUrls(next);
    return () => { for (const u of Object.values(next)) URL.revokeObjectURL(u); };
  }, [data]);
  return urls;
}

/** Outbox commands that still concern a record (shown as "pending sync" markers on detail screens). */
export function usePendingFor(targetId: string | null | undefined): OutboxItem[] {
  const { data } = useOutbox();
  return useMemo(() => (targetId ? data.filter((x) => x.status !== "synced" && (x.targetId === targetId || x.entityClientUuid === targetId)) : []), [data, targetId]);
}

/** Detail screens: the cached copy first, then a fresh one from the server when online; the fresh copy is cached. */
export function useDetail<T>(kind: "observation" | "action" | "run", id: string | null | undefined, fetcher: () => Promise<T>) {
  const key = `${kind}:${id}`;
  const [data, setData] = useState<T | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [n, setN] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const cached = offlineReady() ? await getDetail<T>(key) : null;
      if (cached && !cancelled) { setData(cached.value); setFetchedAt(cached.fetchedAt); setLoading(false); setStale(true); }
      if (!getSyncState().online && cached) { setLoading(false); return; }
      try {
        const fresh = await fetcherRef.current();
        if (cancelled) return;
        setData(fresh);
        setStale(false);
        setFetchedAt(new Date().toISOString());
        setError(null);
        if (offlineReady()) await putDetail(key, fresh);
      } catch (e) {
        if (cancelled) return;
        if (!cached) setError(e);
        else if (!(e instanceof ApiError && e.isNetwork)) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  const update = useCallback((d: T) => { setData(d); if (offlineReady()) void putDetail(key, d); }, [key]);
  return { data, loading, error, stale, fetchedAt, reload, update };
}

/** Form autosave with crash recovery: the draft is restored on mount and written (debounced) on every change. */
export function useDraft<T>(key: string, initial: T, enabled = true): { value: T; set: (v: T | ((p: T) => T)) => void; restored: boolean; ready: boolean; clear: () => Promise<void>; dirty: boolean } {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const timer = useRef(0);
  const initialRef = useRef(initial);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !offlineReady()) { setReady(true); return; }
    getDraft<T>(key).then((d) => {
      if (cancelled) return;
      if (d) { setValue({ ...initialRef.current, ...d.value }); setRestored(true); setDirty(true); }
      setReady(true);
    }, () => setReady(true));
    return () => { cancelled = true; };
  }, [key, enabled]);
  const set = useCallback((v: T | ((p: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      setDirty(true);
      if (enabled && offlineReady()) {
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { void putDraft(key, next); }, 350);
      }
      return next;
    });
  }, [key, enabled]);
  const clear = useCallback(async () => {
    clearTimeout(timer.current);
    setDirty(false);
    setRestored(false);
    if (offlineReady()) await deleteDraft(key);
  }, [key]);
  return { value, set, restored, ready, clear, dirty };
}

export { api };
