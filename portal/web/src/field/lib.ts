/* Field-app helpers: smart defaults (location, categories, owners), SLA arithmetic, titles. */
import type { Area, Category, DirectoryUser, I18n, Me, ObservationType, Site, TemplateVersion, Question } from "../shared/types";
import type { LocalAction, LocalObservation, RefData } from "./offline/db";
import { getJSON, safeGet, setJSON } from "../shared/storage";
import { addWorkingDays } from "../shared/format";
import type { TFn } from "../shared/i18n";

/* ---------------------------------------------------------------- location defaults */
export interface LastLocation { siteId: string; areaId: string | null; assetId?: string | null }
const lastLocKey = (uid: string) => `sw.field.lastloc.${uid}`;
export function readLastLocation(uid: string): LastLocation | null { return getJSON<LastLocation | null>(lastLocKey(uid), null); }
export function writeLastLocation(uid: string, loc: LastLocation) { setJSON(lastLocKey(uid), loc); }

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function nearestSite(sites: Site[], lat: number | null, lng: number | null): Site | null {
  if (lat === null || lng === null) return null;
  let best: Site | null = null, bestD = Infinity;
  for (const s of sites) {
    if (s.lat === null || s.lng === null || !s.active) continue;
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
export function areasOf(ref: RefData, siteId: string | null): Area[] {
  return ref.areas.filter((a) => a.siteId === siteId && a.active).sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
}

/* ---------------------------------------------------------------- categories */
export function categoriesFor(ref: RefData, site: Site | null, type: ObservationType | null): Category[] {
  return ref.categories
    .filter((c) => c.active)
    .filter((c) => !type || !c.appliesTo.types?.length || c.appliesTo.types.includes(type))
    .filter((c) => !site?.industryCode || !c.appliesTo.industries?.length || c.appliesTo.industries.includes(site.industryCode))
    .sort((a, b) => a.sort - b.sort);
}
/** The 6 most-used categories in this area (then site) from the pulled observations, falling back to the admin order. */
export function suggestedCategories(cats: Category[], observations: LocalObservation[], siteId: string | null, areaId: string | null, n = 6): Category[] {
  const count = new Map<string, number>();
  const bump = (o: LocalObservation, w: number) => { for (const c of o.categoryCodes) count.set(c, (count.get(c) ?? 0) + w); };
  for (const o of observations) {
    if (areaId && o.areaId === areaId) bump(o, 3);
    else if (o.siteId === siteId) bump(o, 1);
  }
  const ranked = [...cats].sort((a, b) => (count.get(b.code) ?? 0) - (count.get(a.code) ?? 0) || a.sort - b.sort);
  return ranked.slice(0, n);
}

/* ---------------------------------------------------------------- owners */
/** Owner suggestion for a new action: the area's owner, else the last owner used for that category at the site. */
export function suggestOwner(ref: RefData, actions: LocalAction[], observations: LocalObservation[], siteId: string, areaId: string | null, categoryCode: string | null): string | null {
  const area = ref.areas.find((a) => a.id === areaId);
  if (area?.ownerUserId && ref.directory.some((u) => u.id === area.ownerUserId && u.active)) return area.ownerUserId;
  if (categoryCode) {
    const obsByCat = new Set(observations.filter((o) => o.siteId === siteId && o.categoryCodes.includes(categoryCode)).map((o) => o.id));
    const recent = actions.filter((a) => a.siteId === siteId && a.sourceType === "observation" && a.sourceId && obsByCat.has(a.sourceId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (recent[0]) return recent[0].ownerUserId;
  }
  const site = ref.sites.find((s) => s.id === siteId);
  return site?.siteHeadUserId ?? null;
}
export function assignable(ref: RefData, siteId: string | null): DirectoryUser[] {
  return ref.directory.filter((u) => u.active && (!siteId || u.roles.some((r) => r.siteId === null || r.siteId === siteId))).sort((a, b) => a.name.localeCompare(b.name));
}
export function siteHeads(ref: RefData, siteId: string | null): DirectoryUser[] {
  return ref.directory.filter((u) => u.active && u.roles.some((r) => (r.role === "site_head" || r.role === "hse_manager") && (r.siteId === null || r.siteId === siteId)));
}
export function userName(ref: RefData, id: string | null | undefined, me: Me | null, t: TFn): string {
  if (!id) return "—";
  if (me && id === me.id) return t("common.you");
  return ref.directory.find((u) => u.id === id)?.name ?? "—";
}

/* ---------------------------------------------------------------- SLA */
export function triageDeadline(receivedAt: string, site: Site | undefined, slaWorkingDays: number): Date {
  return addWorkingDays(new Date(receivedAt), Math.max(1, slaWorkingDays), site?.workingCalendar?.weeklyOff ?? [0]);
}
export function countdown(to: Date, t: TFn): { text: string; late: boolean; soon: boolean } {
  const ms = to.getTime() - Date.now();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000), m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h >= 48 ? t("common.days", { count: Math.round(h / 24) }) : h > 0 ? `${h} h ${m} min` : `${m} min`;
  if (ms < 0) return { text: t("common.overdueBy", { time: span }), late: true, soon: false };
  return { text: t("common.dueIn", { time: span }), late: false, soon: h < 4 };
}
export function startOfTodayIST(): Date {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 330 * 60_000);
}
export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const start = startOfTodayIST().getTime();
  const t = new Date(iso).getTime();
  return t >= start && t < start + 86_400_000;
}

/* ---------------------------------------------------------------- titles */
export function obsTitle(o: { type: ObservationType; categoryCodes: string[]; description: string }, ref: RefData, t: TFn, pick: (x: I18n | string | null | undefined) => string): string {
  const cat = ref.categories.find((c) => c.code === o.categoryCodes[0]);
  const head = cat ? pick(cat.name) : t(`type.${o.type}`);
  const desc = o.description?.trim();
  return desc ? `${head} — ${desc.length > 60 ? desc.slice(0, 57) + "…" : desc}` : head;
}
export const TYPE_CLASS: Record<ObservationType, string> = { good_practice: "good", unsafe_act: "act", unsafe_condition: "cond", near_miss: "near" };
export const TYPE_TONE: Record<ObservationType, "green" | "amber" | "orange" | "red"> = { good_practice: "green", unsafe_act: "amber", unsafe_condition: "orange", near_miss: "red" };

/* ---------------------------------------------------------------- templates */
export function templatesFor(ref: RefData, site: Site | null, area: Area | null, assetClass: string | null): TemplateVersion[] {
  return ref.templates.filter((tv) => {
    if (tv.status !== "active") return false;
    const ap = tv.appliesTo;
    if (assetClass) return !ap.assetClasses?.length || ap.assetClasses.includes(assetClass as never);
    if (ap.assetClasses?.length && !ap.areaTypes?.length && !ap.industries?.length) return false;
    if (site?.industryCode && ap.industries?.length && !ap.industries.includes(site.industryCode)) return false;
    if (area && ap.areaTypes?.length && !ap.areaTypes.includes(area.areaType)) return false;
    return true;
  });
}
export function questionFlag(q: Question, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (q.answerType === "pass_fail_na" || q.answerType === "single_choice") {
    const opt = q.responseSet.find((o) => o.value === value);
    return !!opt?.flag;
  }
  if (q.answerType === "multi_choice" && Array.isArray(value)) return value.some((v) => q.responseSet.find((o) => o.value === v)?.flag);
  if (q.answerType === "number" && typeof value === "number") {
    if (q.passMin !== null && value < q.passMin) return true;
    if (q.passMax !== null && value > q.passMax) return true;
  }
  return false;
}
export function docNumber(prefix: string): string {
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------- diagnostics */
export function deviceInfo(): Record<string, string> {
  const ua = navigator.userAgent;
  return {
    ua, platform: (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "", language: navigator.language,
    screen: `${screen.width}×${screen.height} @${window.devicePixelRatio}`, online: String(navigator.onLine), lang: safeGet("sw.lang") ?? "", standalone: String(matchMedia("(display-mode: standalone)").matches),
  };
}
