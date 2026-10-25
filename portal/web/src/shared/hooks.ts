/* Small hooks shared by the apps. */
import { useCallback, useEffect, useRef, useState } from "react";
import { getJSON, setJSON } from "./storage";

/** navigator.onLine plus a real probe: true only when the server answered recently. */
export function useOnline(probe?: () => Promise<boolean>, intervalMs = 30_000): boolean {
  const [online, setOnline] = useState<boolean>(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    let alive = true;
    const up = () => { setOnline(true); void check(); };
    const down = () => setOnline(false);
    async function check() {
      if (!probe) return;
      if (!navigator.onLine) { setOnline(false); return; }
      try {
        const ok = await probe();
        if (alive) setOnline(ok);
      } catch {
        if (alive) setOnline(false);
      }
    }
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const id = probe ? window.setInterval(check, intervalMs) : 0;
    void check();
    return () => { alive = false; window.removeEventListener("online", up); window.removeEventListener("offline", down); if (id) clearInterval(id); };
  }, [probe, intervalMs]);
  return online;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** useState persisted in localStorage (safe when storage is unavailable). */
export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => getJSON<T>(key, initial));
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setV((prev) => {
      const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      setJSON(key, val);
      return val;
    });
  }, [key]);
  return [v, set];
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => (typeof window !== "undefined" ? window.matchMedia(q).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(q);
    const fn = (e: MediaQueryListEvent) => setM(e.matches);
    mq.addEventListener("change", fn);
    setM(mq.matches);
    return () => mq.removeEventListener("change", fn);
  }, [q]);
  return m;
}

export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Re-renders every `ms` so relative times and countdowns stay fresh. */
export function useTick(ms = 30_000): number {
  const [n, setN] = useState(0);
  useInterval(() => setN((x) => x + 1), ms);
  return n;
}

export interface Loaded<T> { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (d: T | null) => void }
/** Loads once per deps change; keeps the previous data while reloading (no flash of skeleton on refresh). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } }, (e) => { if (alive) setError(e); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

/** Geolocation once, with a short timeout; never blocks the form (brief: with no fix the report still saves). */
export function useGeo(enabled = true): { lat: number | null; lng: number | null; accuracyM: number | null; state: "idle" | "locating" | "ok" | "denied" | "unavailable" } {
  const [g, setG] = useState<{ lat: number | null; lng: number | null; accuracyM: number | null; state: "idle" | "locating" | "ok" | "denied" | "unavailable" }>({ lat: null, lng: null, accuracyM: null, state: "idle" });
  useEffect(() => {
    if (!enabled) return;
    if (!("geolocation" in navigator)) { setG((s) => ({ ...s, state: "unavailable" })); return; }
    setG((s) => ({ ...s, state: "locating" }));
    const id = navigator.geolocation.watchPosition(
      (p) => setG({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), state: "ok" }),
      (e) => setG((s) => ({ ...s, state: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable" })),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return g;
}

/** Keyboard shortcuts. Sequences like "g h" are supported; ignored while typing in inputs unless `global`. */
export interface Hotkey { keys: string; handler: (e: KeyboardEvent) => void; global?: boolean; description?: string }
export function useHotkeys(hotkeys: Hotkey[], enabled = true): void {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;
  useEffect(() => {
    if (!enabled) return;
    let prefix = "";
    let timer = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      const combo = `${e.ctrlKey || e.metaKey ? "mod+" : ""}${e.shiftKey && e.key.length > 1 ? "shift+" : ""}${e.key.length === 1 ? e.key.toLowerCase() : e.key}`;
      const seq = prefix ? `${prefix} ${combo}` : combo;
      for (const h of ref.current) {
        if (typing && !h.global && !combo.startsWith("mod+") && combo !== "Escape") continue;
        if (h.keys === seq || h.keys === combo) {
          e.preventDefault();
          prefix = "";
          h.handler(e);
          return;
        }
      }
      if (!typing && ref.current.some((h) => h.keys.startsWith(combo + " "))) {
        prefix = combo;
        clearTimeout(timer);
        timer = window.setTimeout(() => { prefix = ""; }, 900);
      } else prefix = "";
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [enabled]);
}

/** Warn before the tab closes while there is unsaved work. */
export function useBeforeUnload(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
}
