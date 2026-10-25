/* Site scope (the top-bar site filter) and cached reference data every screen reaches for:
   sites, areas per site, categories, contractors, risk matrix versions, due-date rules, industries, directory search. */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Area, Category, Contractor, DueDateRule, IndustryProfile, RiskMatrixVersion, Site, UserAdmin } from "../shared/types";
import { api, asList } from "./api";
import { useLocalState } from "../shared/hooks";
import { useAuth } from "./auth";
import { DEFAULT_DUE_RULES, DEFAULT_MATRIX } from "../shared/risk";

interface RefState<T> { data: T; loaded: boolean; error: unknown }

interface ScopeCtx {
  siteId: string; // "" = all sites in scope
  setSiteId: (id: string) => void;
  sites: Site[];
  site: Site | null;
  siteName: (id: string | null | undefined) => string;
  reloadSites: () => Promise<void>;
  categories: RefState<Category[]>;
  contractors: RefState<Contractor[]>;
  matrices: RefState<RiskMatrixVersion[]>;
  activeMatrix: (siteId?: string | null) => RiskMatrixVersion;
  dueRules: RefState<DueDateRule[]>;
  industries: RefState<IndustryProfile[]>;
  loadIndustries: () => Promise<IndustryProfile[]>;
  areasFor: (siteId: string) => Area[];
  loadAreas: (siteId: string, force?: boolean) => Promise<Area[]>;
  areaName: (siteId: string | null | undefined, areaId: string | null | undefined) => string;
  employerName: (id: string | null | undefined) => string;
  searchUsers: (q: string, siteId?: string | null) => Promise<UserAdmin[]>;
  reload: (what: "categories" | "contractors" | "matrices" | "dueRules" | "industries") => Promise<void>;
}

const Ctx = createContext<ScopeCtx | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { me, setMe } = useAuth();
  const [siteId, setSiteIdRaw] = useLocalState<string>("sw.admin.site", "");
  const [sites, setSites] = useState<Site[]>(me?.sites ?? []);
  useEffect(() => { setSites(me?.sites ?? []); }, [me]);
  // if the saved site is no longer in scope, fall back to all
  useEffect(() => { if (siteId && sites.length && !sites.some((s) => s.id === siteId)) setSiteIdRaw(""); }, [siteId, sites, setSiteIdRaw]);

  const [categories, setCategories] = useState<RefState<Category[]>>({ data: [], loaded: false, error: null });
  const [contractors, setContractors] = useState<RefState<Contractor[]>>({ data: [], loaded: false, error: null });
  const [matrices, setMatrices] = useState<RefState<RiskMatrixVersion[]>>({ data: [], loaded: false, error: null });
  const [dueRules, setDueRules] = useState<RefState<DueDateRule[]>>({ data: [], loaded: false, error: null });
  const [industries, setIndustries] = useState<RefState<IndustryProfile[]>>({ data: [], loaded: false, error: null });
  const [areas, setAreas] = useState<Record<string, Area[]>>({});
  const areaLoads = useRef<Record<string, Promise<Area[]>>>({});

  const load = useCallback(async (what: "categories" | "contractors" | "matrices" | "dueRules" | "industries") => {
    const paths = { categories: "/admin/categories", contractors: "/admin/contractors", matrices: "/admin/risk-matrices", dueRules: "/admin/due-date-rules", industries: "/admin/industries" } as const;
    const setters = { categories: setCategories, contractors: setContractors, matrices: setMatrices, dueRules: setDueRules, industries: setIndustries } as const;
    try {
      const r = await api.get(paths[what]);
      let list = asList<unknown>(r);
      if (what === "matrices") {
        // GET /admin/risk-matrices may answer matrices with nested versions or a flat list of versions
        list = list.flatMap((m: any) => (Array.isArray(m?.versions) ? m.versions : [m]));
      }
      (setters[what] as (s: RefState<any>) => void)({ data: list, loaded: true, error: null });
    } catch (e) {
      (setters[what] as (s: RefState<any>) => void)((prev: RefState<any>) => ({ ...prev, loaded: true, error: e }));
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    void load("categories"); void load("contractors"); void load("matrices"); void load("dueRules");
  }, [me, load]);

  const loadAreas = useCallback(async (sid: string, force = false) => {
    if (!sid) return [];
    if (!force && areas[sid]) return areas[sid];
    if (!force && areaLoads.current[sid]) return areaLoads.current[sid];
    const p = api.get(`/admin/sites/${sid}/areas`).then((r) => {
      const list = asList<Area>(r).slice().sort((a, b) => a.sort - b.sort);
      setAreas((prev) => ({ ...prev, [sid]: list }));
      delete areaLoads.current[sid];
      return list;
    }).catch((e) => { delete areaLoads.current[sid]; throw e; });
    areaLoads.current[sid] = p;
    return p;
  }, [areas]);

  const value = useMemo<ScopeCtx>(() => ({
    siteId,
    setSiteId: (id) => setSiteIdRaw(id),
    sites,
    site: sites.find((s) => s.id === siteId) ?? null,
    siteName: (id) => { if (!id) return ""; const s = sites.find((x) => x.id === id); return s ? (s.name.en || s.code) : ""; },
    reloadSites: async () => {
      const r = await api.get("/admin/sites");
      const list = asList<Site>(r);
      setSites(list);
      if (me) setMe({ ...me, sites: list });
    },
    categories, contractors, matrices, dueRules, industries,
    activeMatrix: (sid) => {
      const site = sid ? sites.find((s) => s.id === sid) : null;
      const byId = site?.riskMatrixVersionId ? matrices.data.find((m) => m.id === site.riskMatrixVersionId) : null;
      return byId ?? matrices.data.find((m) => m.status === "active") ?? DEFAULT_MATRIX;
    },
    loadIndustries: async () => { if (!industries.loaded) await load("industries"); return industries.data; },
    areasFor: (sid) => areas[sid] ?? [],
    loadAreas,
    areaName: (sid, aid) => { if (!sid || !aid) return ""; const a = (areas[sid] ?? []).find((x) => x.id === aid); return a ? (a.name.en || a.code) : ""; },
    employerName: (id) => { if (!id) return ""; return contractors.data.find((c) => c.id === id)?.name ?? ""; },
    searchUsers: async (q, sid) => {
      const r = await api.get("/admin/users", { q, siteId: sid || undefined, status: "active", pageSize: 8, page: 1 });
      return asList<UserAdmin>(r);
    },
    reload: load,
  }), [siteId, sites, categories, contractors, matrices, dueRules, industries, areas, loadAreas, load, me, setMe, setSiteIdRaw]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScope(): ScopeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useScope outside ScopeProvider");
  return c;
}

/** Due-date rules in effect (server list, else the design defaults). */
export function useDueRules(): DueDateRule[] {
  const { dueRules } = useScope();
  return dueRules.data.length ? dueRules.data : DEFAULT_DUE_RULES;
}
