/* Dates, durations and labels. Times are shown in India Standard Time whatever the device clock says. */
import type { Band, Lang } from "./types";
import type { TFn } from "./i18n";

export const TZ = "Asia/Kolkata";
const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", ta: "ta-IN", kn: "kn-IN" };

export function fmtDate(iso: string | null | undefined, lang: Lang = "en"): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00+05:30" : iso);
  return d.toLocaleDateString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}
export function fmtDateTime(iso: string | null | undefined, lang: Lang = "en"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
export function fmtTime(iso: string | null | undefined, lang: Lang = "en"): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
export function fmtNumber(n: number | null | undefined, lang: Lang = "en", digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(LOCALE[lang], { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function pct(v: number | null | undefined, lang: Lang = "en"): string {
  return v === null || v === undefined ? "—" : `${fmtNumber(v, lang, v < 10 ? 1 : 0)}%`;
}

/** "Just now", "5 minutes ago", "Yesterday", or a date. */
export function relative(iso: string | null | undefined, t: TFn, lang: Lang = "en"): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return t("common.now");
  if (min < 60) return t("common.minutesAgo", { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("common.hoursAgo", { count: h });
  const d = Math.round(h / 24);
  if (d === 1) return t("common.yesterday");
  if (d < 7) return t("common.daysAgo", { count: d });
  return fmtDate(iso, lang);
}

/** Due countdown text and whether it is late. */
export function dueText(dueAt: string | null | undefined, open: boolean, t: TFn): { text: string; late: boolean; soon: boolean } {
  if (!dueAt) return { text: "", late: false, soon: false };
  const ms = new Date(dueAt).getTime() - Date.now();
  const hours = Math.max(1, Math.round(Math.abs(ms) / 3_600_000));
  const days = Math.round(Math.abs(ms) / 86_400_000);
  const span = hours < 48 ? t("common.hours", { count: hours }) : t("common.days", { count: days });
  if (!open) return { text: fmtDate(dueAt), late: false, soon: false };
  if (ms < 0) return { text: t("common.overdueBy", { time: span }), late: true, soon: false };
  return { text: t("common.dueIn", { time: span }), late: false, soon: hours <= 24 };
}

export const BAND_ORDER: Band[] = ["extreme", "high", "moderate", "low"];
export const BAND_COLOUR: Record<Band, "red" | "orange" | "amber" | "green"> = { extreme: "red", high: "orange", moderate: "amber", low: "green" };
export function bandLabel(band: Band | null | undefined, t: TFn): string {
  return band ? t(`band.${band}`) : "";
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}

export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Working-day aware addition using a site's weekly-off days (0 = Sunday). */
export function addWorkingDays(from: Date, days: number, weeklyOff: number[] = [0]): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!weeklyOff.includes(d.getDay())) left--;
  }
  return d;
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
