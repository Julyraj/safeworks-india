/* Session for the console: login (kind admin) → optional MFA (with TOTP enrolment) → must-change-password → ready.
   Exposes `me`, role helpers and the actions the shell needs. */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LoginResponse, Me, MfaEnrolResponse, Role } from "../shared/types";
import { api, ApiError } from "./api";
import { deviceId } from "../shared/storage";

export type AuthStage = "booting" | "login" | "mfa" | "enrol" | "changePassword" | "ready";
export const APP_VERSION = "2.0.0-admin";

export interface Perms {
  roles: Role[];
  isAdmin: boolean;
  isHse: boolean;
  isAuditor: boolean;
  isSiteHead: (siteId?: string | null) => boolean;
  isOfficer: (siteId?: string | null) => boolean; // site_safety_officer, site_head or hse_manager at the site (or all sites)
  canTriage: boolean; // officer and above somewhere; admin never
  canConfigurePeople: boolean; // admin
  canConfigureSafety: boolean; // hse_manager
  canSiteConfig: (siteId?: string | null) => boolean; // areas, QR, schedules, template copies
  readOnly: boolean; // auditor
  auditorExpiresAt: string | null;
  medicalData: boolean;
}

interface AuthCtx {
  stage: AuthStage;
  me: Me | null;
  perms: Perms;
  enrol: MfaEnrolResponse | null;
  pendingLogin: string;
  login: (login: string, password: string) => Promise<void>;
  submitMfa: (code: string) => Promise<void>;
  startEnrol: () => Promise<void>;
  confirmEnrol: (code: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setMe: (m: Me) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

function permsFor(me: Me | null): Perms {
  const roles = me?.roles ?? [];
  const has = (r: Role, siteId?: string | null) => roles.some((x) => x.role === r && (x.siteId === null || !siteId || x.siteId === siteId));
  const isHse = has("hse_manager");
  const isAdmin = has("admin");
  const isAuditor = has("auditor") && !isAdmin && !isHse;
  const officer = (siteId?: string | null) => has("site_safety_officer", siteId) || has("site_head", siteId) || isHse;
  return {
    roles: [...new Set(roles.map((r) => r.role))],
    isAdmin,
    isHse,
    isAuditor,
    isSiteHead: (siteId) => has("site_head", siteId) || isHse,
    isOfficer: officer,
    canTriage: roles.some((r) => r.role === "site_safety_officer" || r.role === "site_head" || r.role === "hse_manager"),
    canConfigurePeople: isAdmin,
    canConfigureSafety: isHse,
    canSiteConfig: (siteId) => isAdmin || officer(siteId),
    readOnly: isAuditor,
    auditorExpiresAt: roles.find((r) => r.role === "auditor")?.expiresAt ?? null,
    medicalData: roles.some((r) => r.medicalData),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<AuthStage>("booting");
  const [me, setMeState] = useState<Me | null>(null);
  const [enrol, setEnrol] = useState<MfaEnrolResponse | null>(null);
  const [pendingLogin, setPendingLogin] = useState("");

  const applyLogin = useCallback((r: LoginResponse) => {
    api.setToken(r.token);
    if (r.mfaRequired) {
      setStage(r.mfaEnrolled === false ? "enrol" : "mfa");
      return;
    }
    if (r.mustChangePassword || r.me?.mustChangePassword) {
      if (r.me) setMeState(r.me);
      setStage("changePassword");
      return;
    }
    if (r.me) setMeState(r.me);
    setStage("ready");
  }, []);

  const refreshMe = useCallback(async () => {
    const m = await api.get<Me>("/me");
    setMeState(m);
    setStage(m.mustChangePassword ? "changePassword" : "ready");
  }, []);

  useEffect(() => {
    api.onUnauthorized(() => {
      api.setToken(null);
      setMeState(null);
      setStage("login");
    });
    if (!api.token()) { setStage("login"); return; }
    refreshMe().catch((e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        if (e.code === "mfa_required") setStage("mfa");
        else if (e.code === "must_change_password") setStage("changePassword");
        else { api.setToken(null); setStage("login"); }
      } else setStage("login");
    });
  }, [refreshMe]);

  const value = useMemo<AuthCtx>(() => ({
    stage, me, perms: permsFor(me), enrol, pendingLogin,
    login: async (login, password) => {
      setPendingLogin(login);
      const r = await api.post<LoginResponse>("/auth/login", { login, password, kind: "admin", deviceUuid: deviceId(), platform: "web", appVersion: APP_VERSION });
      applyLogin(r);
      if (!r.mfaRequired && !r.me && !r.mustChangePassword) await refreshMe();
    },
    submitMfa: async (code) => {
      const r = await api.post<LoginResponse>("/auth/mfa", { code });
      applyLogin(r);
      if (!r.me && !r.mustChangePassword) await refreshMe();
    },
    startEnrol: async () => {
      const e = await api.post<MfaEnrolResponse>("/auth/mfa/enrol");
      setEnrol(e);
    },
    confirmEnrol: async (code) => {
      const r = await api.post<LoginResponse>("/auth/mfa/confirm", { code });
      setEnrol(null);
      applyLogin(r);
      if (!r.me && !r.mustChangePassword) await refreshMe();
    },
    changePassword: async (current, next) => {
      await api.post("/auth/password", { current, new: next });
      await refreshMe();
    },
    logout: async () => {
      try { await api.post("/auth/logout"); } catch { /* the token may already be gone */ }
      api.setToken(null);
      setMeState(null);
      setEnrol(null);
      setStage("login");
    },
    refreshMe,
    setMe: (m) => setMeState(m),
  }), [stage, me, enrol, pendingLogin, applyLogin, refreshMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
