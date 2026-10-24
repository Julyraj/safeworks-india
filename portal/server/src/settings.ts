import { Db, one, pool } from "./db.js";

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export interface OrgSettings {
  dueDays: Record<RiskLevel, number>;
  escalation: { siteHeadDays: number; adminDays: number };
  dueReminderHours: number;
}

export const DEFAULT_SETTINGS: OrgSettings = {
  dueDays: { Critical: 1, High: 3, Medium: 7, Low: 15 },
  escalation: { siteHeadDays: 3, adminDays: 7 },
  dueReminderHours: 24,
};

export function mergeSettings(raw: any): OrgSettings {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    dueDays: { ...DEFAULT_SETTINGS.dueDays, ...(s.dueDays || {}) },
    escalation: { ...DEFAULT_SETTINGS.escalation, ...(s.escalation || {}) },
    dueReminderHours: Number(s.dueReminderHours ?? DEFAULT_SETTINGS.dueReminderHours),
  };
}

let cache: { orgId: string; at: number; settings: OrgSettings; name: string } | null = null;

export async function getOrg(orgId: string, db: Db = pool): Promise<{ name: string; settings: OrgSettings }> {
  if (cache && cache.orgId === orgId && Date.now() - cache.at < 15_000) return { name: cache.name, settings: cache.settings };
  const row = await one<{ name: string; settings: any }>(`select name, settings from organisations where id = $1`, [orgId], db);
  const settings = mergeSettings(row?.settings);
  cache = { orgId, at: Date.now(), settings, name: row?.name ?? "" };
  return { name: row?.name ?? "", settings };
}

export function clearOrgCache(): void {
  cache = null;
}

export function riskOf(severity: number | null | undefined, likelihood: number | null | undefined, workStopped: boolean): { score: number | null; level: RiskLevel | null } {
  if (!severity || !likelihood) return { score: null, level: workStopped ? "Critical" : null };
  const score = severity * likelihood;
  let level: RiskLevel = score >= 15 ? "Critical" : score >= 10 ? "High" : score >= 5 ? "Medium" : "Low";
  if (workStopped) level = "Critical";
  return { score, level };
}
