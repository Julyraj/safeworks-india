/* Translation layer for every SafeWorks web app.
   - Packs are flat JSON maps: key → string, with `{name}` placeholders and a tiny plural form
     `{count, plural, one {# item} other {# items}}` (# is replaced by the number).
   - `shared.<lang>.json` holds the kit's strings; each app adds its own pack (field.<lang>.json, admin.<lang>.json).
   - Missing strings fall back to English, then to the key itself, and are reported once to `onMissing`
     so the admin "language packs" screen can list them.
   - Company overrides (from the server's translations table) are layered on top at runtime. */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { I18n, Lang } from "../types";
import sharedEn from "./shared.en.json";
import sharedHi from "./shared.hi.json";
import sharedTa from "./shared.ta.json";
import sharedKn from "./shared.kn.json";

export type Pack = Record<string, string>;
export type Packs = Record<Lang, Pack>;

export const LANGS: Lang[] = ["en", "hi", "ta", "kn"];
export const LANG_NAMES: Record<Lang, string> = { en: "English", hi: "हिन्दी", ta: "தமிழ்", kn: "ಕನ್ನಡ" };
export const LANG_KEY = "sw.lang";

const SHARED: Packs = { en: sharedEn, hi: sharedHi, ta: sharedTa, kn: sharedKn };

const missing = new Set<string>();
let onMissing: ((key: string, lang: Lang) => void) | null = null;
export function setMissingReporter(fn: ((key: string, lang: Lang) => void) | null) { onMissing = fn; }
export function missingKeys(): string[] { return [...missing]; }

const PLURAL_RE = /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g;

export function format(template: string, vars?: Record<string, string | number | null | undefined>): string {
  let out = template;
  if (vars) {
    out = out.replace(PLURAL_RE, (_m, name: string, one: string, other: string) => {
      const n = Number(vars[name] ?? 0);
      return (n === 1 ? one : other).replace(/#/g, String(n));
    });
    out = out.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const v = vars[name];
      return v === null || v === undefined ? "" : String(v);
    });
  }
  return out;
}

export function makeT(lang: Lang, packs: Packs, overrides?: Partial<Record<Lang, Pack>>) {
  return (key: string, vars?: Record<string, string | number | null | undefined>): string => {
    const s = overrides?.[lang]?.[key] ?? packs[lang]?.[key] ?? overrides?.en?.[key] ?? packs.en[key];
    if (s === undefined) {
      if (!missing.has(`${lang}:${key}`)) {
        missing.add(`${lang}:${key}`);
        onMissing?.(key, lang);
      }
      return key;
    }
    if (lang !== "en" && packs[lang]?.[key] === undefined && overrides?.[lang]?.[key] === undefined && !missing.has(`${lang}:${key}`)) {
      missing.add(`${lang}:${key}`);
      onMissing?.(key, lang);
    }
    return format(s, vars);
  };
}

export type TFn = ReturnType<typeof makeT>;

/** Picks the right text out of a `{en, hi, ta, kn}` object, falling back to English. */
export function pick(obj: I18n | Record<string, string> | string | null | undefined, lang: Lang): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return (obj as Record<string, string>)[lang] || obj.en || Object.values(obj).find(Boolean) || "";
}

export function mergePacks(...sets: Partial<Packs>[]): Packs {
  const out: Packs = { en: {}, hi: {}, ta: {}, kn: {} };
  for (const set of sets) for (const l of LANGS) Object.assign(out[l], set[l] ?? {});
  return out;
}

export function readSavedLang(fallback: Lang = "en"): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY) as Lang | null;
    if (v && LANGS.includes(v)) return v;
  } catch { /* storage unavailable */ }
  const nav = (navigator.language || "en").slice(0, 2) as Lang;
  return LANGS.includes(nav) ? nav : fallback;
}

export function saveLang(lang: Lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage unavailable */ }
  document.documentElement.lang = lang === "en" ? "en-IN" : `${lang}-IN`;
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
  pick: (obj: I18n | Record<string, string> | string | null | undefined) => string;
  setOverrides: (o: Partial<Record<Lang, Pack>>) => void;
}

const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ packs, initial, children }: { packs: Partial<Packs>; initial?: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial ?? readSavedLang());
  const [overrides, setOverrides] = useState<Partial<Record<Lang, Pack>>>({});
  const merged = useMemo(() => mergePacks(SHARED, packs), [packs]);
  const t = useMemo(() => makeT(lang, merged, overrides), [lang, merged, overrides]);
  const setLang = useCallback((l: Lang) => { saveLang(l); setLangState(l); }, []);
  useEffect(() => { saveLang(lang); }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t, pick: (o) => pick(o, lang), setOverrides }), [lang, setLang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("useI18n must be used inside <I18nProvider>");
  return c;
}

export const useT = () => useI18n().t;
