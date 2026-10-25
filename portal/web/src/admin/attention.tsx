/* "What needs attention": one loader shared by the Attention board and the rail badge. Each item links into the screen that fixes it. */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Dashboard, Health, ObservationSummary, Paged, RuleSet, TranslationPack } from "../shared/types";
import { api, asList, asPaged } from "./api";
import type { AttentionItem } from "./types";
import { useScope } from "./scope";
import { useAuth } from "./auth";

interface AttentionCtx { items: AttentionItem[]; loading: boolean; error: unknown; reload: () => void; loadedAt: string | null; urgent: number }
const Ctx = createContext<AttentionCtx | null>(null);

async function safe<T>(p: Promise<T>): Promise<T | null> { try { return await p; } catch { return null; } }

export async function loadAttention(siteId: string, opts: { config: boolean; sites: { ruleSetCode: string | null }[] }): Promise<AttentionItem[]> {
  const sq = siteId ? `&siteId=${siteId}` : "";
  const siteQuery = siteId ? { siteId } : {};
  const [overdue, backlog, extreme, missed, dash, ruleSets, health, hi, ta, kn] = await Promise.all([
    safe(api.get<Paged<unknown>>("/actions", { ...siteQuery, overdue: 1, pageSize: 1 })),
    safe(api.get<Paged<unknown>>("/observations", { ...siteQuery, status: "submitted", pageSize: 1 })),
    safe(api.get<Paged<ObservationSummary>>("/observations", { ...siteQuery, band: "extreme", pageSize: 50 })),
    safe(api.get<Paged<unknown>>("/inspections/runs", { ...siteQuery, status: "missed", pageSize: 1 })),
    safe(api.get<Dashboard>("/dashboard", siteId ? { siteIds: siteId } : {})),
    opts.config ? safe(api.get("/admin/rule-sets")) : Promise.resolve(null),
    opts.config ? safe(api.get<Health>("/admin/health")) : Promise.resolve(null),
    opts.config ? safe(api.get<TranslationPack>("/admin/translations", { lang: "hi" })) : Promise.resolve(null),
    opts.config ? safe(api.get<TranslationPack>("/admin/translations", { lang: "ta" })) : Promise.resolve(null),
    opts.config ? safe(api.get<TranslationPack>("/admin/translations", { lang: "kn" })) : Promise.resolve(null),
  ]);
  const items: AttentionItem[] = [];
  const total = (p: unknown) => (p ? asPaged(p, 1, 1).total : 0);
  items.push({ kind: "overdue_actions", count: total(overdue), tone: "red", to: `/actions?overdue=1${sq}` });
  const backlogN = total(backlog);
  items.push({ kind: "triage_backlog", count: backlogN, tone: "orange", to: `/observations?status=submitted${sq}`, detail: dash?.kpis.find((k) => k.key === "triage_backlog" || k.key === "triageBacklog")?.hint?.en });
  const unacked = extreme ? asList<ObservationSummary>(extreme).filter((o) => !o.criticalAckedAt && o.status !== "closed" && o.status !== "discarded" && o.status !== "merged") : [];
  items.push({ kind: "critical_unacked", count: unacked.length, tone: "red", to: `/observations?band=extreme${sq}` });
  items.push({ kind: "missed_inspections", count: total(missed), tone: "amber", to: `/inspections?status=missed${sq}` });
  const repeats = dash?.topRepeatFindings?.reduce((a, r) => a + r.count, 0) ?? 0;
  items.push({ kind: "repeat_findings", count: repeats, tone: "amber", to: "/", detail: dash?.topRepeatFindings?.[0] ? dash.topRepeatFindings[0].questionText.en : undefined });
  if (opts.config) {
    const sets = asList<RuleSet>(ruleSets);
    const inUse = new Set(opts.sites.map((s) => s.ruleSetCode).filter(Boolean));
    const unverified = sets.filter((r) => (inUse.has(r.code) || r.enabled) && r.status !== "verified_primary" && r.status !== "verified_secondary");
    items.push({ kind: "rule_sets_unverified", count: unverified.length, tone: "blue", to: "/rule-sets", detail: unverified.map((r) => r.code).slice(0, 3).join(", ") || undefined });
    const packs = [["hi", hi], ["ta", ta], ["kn", kn]] as const;
    const incomplete = packs.filter(([, p]) => p && p.translated < p.total);
    items.push({ kind: "language_incomplete", count: incomplete.length, tone: "blue", to: "/languages", detail: incomplete.map(([l, p]) => `${l}: ${(p as TranslationPack).total - (p as TranslationPack).translated}`).join(" · ") || undefined });
    let hw = 0; const notes: string[] = [];
    if (health) {
      if (health.db !== "ok") { hw++; notes.push("db"); }
      if (health.failedNotifications24h > 0) { hw++; notes.push(`notifications ${health.failedNotifications24h}`); }
      if (health.syncRejected24h > 0) { hw++; notes.push(`sync ${health.syncRejected24h}`); }
      const last = health.backups?.lastAt ? Date.now() - new Date(health.backups.lastAt).getTime() : Infinity;
      if (last > 2 * 86_400_000) { hw++; notes.push("backup"); }
    }
    items.push({ kind: "health", count: hw, tone: "orange", to: "/health", detail: notes.join(" · ") || undefined });
  }
  return items;
}

export function AttentionProvider({ children }: { children: ReactNode }) {
  const { siteId, sites } = useScope();
  const { perms } = useAuth();
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const config = perms.isAdmin || perms.isHse;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadAttention(siteId, { config, sites }).then((it) => { if (alive) { setItems(it); setError(null); setLoadedAt(new Date().toISOString()); } }, (e) => { if (alive) setError(e); }).finally(() => { if (alive) setLoading(false); });
    const id = window.setInterval(() => setN((x) => x + 1), 120_000);
    return () => { alive = false; clearInterval(id); };
  }, [siteId, config, sites, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  const value = useMemo<AttentionCtx>(() => ({
    items, loading, error, reload, loadedAt,
    urgent: items.filter((i) => i.tone === "red" || i.tone === "orange").reduce((a, i) => a + i.count, 0),
  }), [items, loading, error, reload, loadedAt]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAttention(): AttentionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAttention outside AttentionProvider");
  return c;
}
