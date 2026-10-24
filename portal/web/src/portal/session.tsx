import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, safeGet, safeSet } from "../shared/api";
import type { Master, Me, Site } from "../shared/types";

export const api = createApi("sw:token");

interface Session {
  me: Me;
  sites: Site[];
  master: Master;
  site: Site | null;
  setSiteId: (id: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  isSafetyOfficer: boolean;
  isSupervisorOnly: boolean;
  canRaiseAnywhere: boolean;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("No session");
  return s;
}

type State = { phase: "loading" } | { phase: "signed-out" } | { phase: "must-change"; me: Me } | { phase: "ready"; me: Me; sites: Site[]; master: Master } | { phase: "error"; error: string };

export function SessionProvider({ children, signedOut, mustChange, failed }: { children: ReactNode; signedOut: (done: () => void) => ReactNode; mustChange: (me: Me, done: () => void) => ReactNode; failed: (msg: string, retry: () => void) => ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [siteId, setSiteIdState] = useState<string>(safeGet("sw:site") || "");

  const load = useCallback(async () => {
    if (!api.token()) {
      setState({ phase: "signed-out" });
      return;
    }
    try {
      const me = await api.get<Me>("/api/me");
      if (me.mustChangePassword) {
        setState({ phase: "must-change", me });
        return;
      }
      const [s, master] = await Promise.all([api.get<{ sites: Site[] }>("/api/sites"), api.get<Master>("/api/master")]);
      setState({ phase: "ready", me, sites: s.sites, master });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        api.setToken(null);
        setState({ phase: "signed-out" });
      } else if (err.code === "must_change_password") {
        const me = await api.get<Me>("/api/me").catch(() => null);
        if (me) setState({ phase: "must-change", me });
        else setState({ phase: "signed-out" });
      } else setState({ phase: "error", error: err.message });
    }
  }, []);

  useEffect(() => {
    api.onUnauthorized(() => {
      api.setToken(null);
      setState({ phase: "signed-out" });
    });
    load();
  }, [load]);

  const value = useMemo<Session | null>(() => {
    if (state.phase !== "ready") return null;
    const { me, sites, master } = state;
    const site = sites.find((s) => s.id === siteId) ?? sites.find((s) => s.can.raise) ?? sites[0] ?? null;
    const isSafetyOfficer = me.roles.some((r) => r.role === "safety_officer" || r.role === "org_admin" || r.role === "platform_admin");
    const isSupervisorOnly = me.roles.every((r) => r.role === "supervisor");
    return {
      me,
      sites,
      master,
      site,
      setSiteId: (id) => {
        safeSet("sw:site", id);
        setSiteIdState(id);
      },
      refresh: load,
      signOut: async () => {
        await api.post("/api/auth/logout").catch(() => {});
        api.setToken(null);
        setState({ phase: "signed-out" });
      },
      isSafetyOfficer,
      isSupervisorOnly,
      canRaiseAnywhere: sites.some((s) => s.can.raise),
    };
  }, [state, siteId, load]);

  if (state.phase === "loading") return <div className="login-wrap"><div className="spinner" style={{ borderColor: "rgba(255,255,255,.2)", borderTopColor: "#F5C400" }} /></div>;
  if (state.phase === "signed-out") return <>{signedOut(load)}</>;
  if (state.phase === "must-change") return <>{mustChange(state.me, load)}</>;
  if (state.phase === "error") return <>{failed(state.error, load)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
