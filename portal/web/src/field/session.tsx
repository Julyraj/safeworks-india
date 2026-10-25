/* Session: sign-in flows (employee code or email + password, TOTP step and enrolment, one-time enrolment code,
   must-change-password), the `Me` cache in IndexedDB so the app opens offline, and a logout that refuses to run while
   the outbox still holds this user's unsynced work. */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { EnrolRequest, LoginResponse, Me, MfaEnrolResponse, Preferences } from "../shared/types";
import { ApiError, isNative, serverBase } from "../shared/api";
import { deviceId, safeGet, safeSet } from "../shared/storage";
import { useI18n } from "../shared/i18n";
import { api, APP_VERSION, UID_KEY } from "./api";
import { closeOffline, getMeta, initOffline, setMeta, wipeUserData, allOutbox } from "./offline/db";
import { setSyncHandlers, startSync, stopSync, syncNow } from "./offline/sync";

export type SessionStatus = "booting" | "needs_server" | "anon" | "mfa" | "must_change" | "authed" | "boot_error";

interface SessionCtx {
  status: SessionStatus;
  me: Me | null;
  mfaEnrolled: boolean;
  bootError: unknown;
  login: (login: string, password: string) => Promise<void>;
  mfa: (code: string) => Promise<void>;
  mfaEnrolStart: () => Promise<MfaEnrolResponse>;
  mfaConfirm: (code: string) => Promise<void>;
  enrol: (code: string, newPassword: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  logout: () => Promise<{ blocked: true; pending: number } | { blocked: false }>;
  forceSignOutKeepData: () => void;
  updateMe: (me: Me) => void;
  savePreferences: (p: Preferences) => Promise<void>;
  ackPrivacy: (version: number) => Promise<void>;
  retryBoot: () => void;
  serverConfigured: () => void;
}
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLang, setOverrides } = useI18n();
  const [status, setStatus] = useState<SessionStatus>("booting");
  const [me, setMe] = useState<Me | null>(null);
  const [mfaEnrolled, setMfaEnrolled] = useState(true);
  const [bootError, setBootError] = useState<unknown>(null);
  const [bootN, setBootN] = useState(0);
  const langApplied = useRef(false);

  const activate = useCallback(async (m: Me, token?: string) => {
    if (token) api.setToken(token);
    safeSet(UID_KEY, m.id);
    await initOffline(m.id);
    await setMeta("me", m);
    setMe(m);
    if (!langApplied.current && m.language) { setLang(m.language); langApplied.current = true; }
    setStatus("authed");
    setSyncHandlers({ onMe: (fresh) => setMe(fresh), onOverrides: (o) => setOverrides(o) });
    await startSync();
  }, [setLang, setOverrides]);

  const handleLogin = useCallback(async (res: LoginResponse) => {
    if (res.mfaRequired) {
      api.setToken(res.token);
      setMfaEnrolled(res.mfaEnrolled !== false);
      setStatus("mfa");
      return;
    }
    if (res.mustChangePassword || res.me?.mustChangePassword) {
      api.setToken(res.token);
      if (res.me) setMe(res.me);
      setStatus("must_change");
      return;
    }
    const m = res.me ?? (await (async () => { api.setToken(res.token); return api.get<Me>("/me"); })());
    await activate(m, res.token);
  }, [activate]);

  // boot: cached session first (works offline), then the server refreshes it through pull
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isNative && !serverBase()) { setStatus("needs_server"); return; }
      const token = api.token();
      const uid = safeGet(UID_KEY);
      if (!token) { setStatus("anon"); return; }
      try {
        if (uid) {
          await initOffline(uid);
          const cached = await getMeta<Me | null>("me", null);
          if (cached && !cancelled) { await activate(cached); return; }
        }
        const m = await api.get<Me>("/me");
        if (!cancelled) await activate(m);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) { api.setToken(null); setStatus("anon"); return; }
        if (e instanceof ApiError && e.code === "must_change_password") { setStatus("must_change"); return; }
        setBootError(e);
        setStatus("boot_error");
      }
    })();
    return () => { cancelled = true; };
  }, [activate, bootN]);

  // the server said 401: back to the sign-in screen without touching the outbox
  useEffect(() => {
    api.onUnauthorized(() => {
      api.setToken(null);
      stopSync();
      setStatus((s) => (s === "authed" || s === "mfa" || s === "must_change" ? "anon" : s));
    });
  }, []);

  const value = useMemo<SessionCtx>(() => ({
    status, me, mfaEnrolled, bootError,
    login: async (login, password) => {
      const res = await api.post<LoginResponse>("/auth/login", { login: login.trim(), password, kind: "field", deviceUuid: deviceId(), platform: isNative ? "android" : "web", appVersion: APP_VERSION });
      await handleLogin(res);
    },
    mfa: async (code) => { await handleLogin(await api.post<LoginResponse>("/auth/mfa", { code: code.trim() })); },
    mfaEnrolStart: () => api.post<MfaEnrolResponse>("/auth/mfa/enrol", {}),
    mfaConfirm: async (code) => { await handleLogin(await api.post<LoginResponse>("/auth/mfa/confirm", { code: code.trim() })); },
    enrol: async (code, newPassword) => {
      const body: EnrolRequest = { code: code.trim(), newPassword, deviceUuid: deviceId(), platform: isNative ? "android" : "web", appVersion: APP_VERSION };
      await handleLogin(await api.post<LoginResponse>("/auth/enrol", body));
    },
    changePassword: async (current, next) => {
      await api.post("/auth/password", { current, new: next });
      const m = await api.get<Me>("/me");
      await activate(m);
    },
    logout: async () => {
      const uid = safeGet(UID_KEY);
      let pending = 0;
      try { pending = (await allOutbox()).filter((x) => x.status === "pending" || x.status === "sending" || x.status === "failed").length; } catch { pending = 0; }
      if (pending > 0) return { blocked: true, pending };
      try { await api.post("/auth/logout", {}); } catch { /* best effort; the token is dropped anyway */ }
      stopSync();
      api.setToken(null);
      closeOffline();
      if (uid) await wipeUserData(uid);
      safeSet(UID_KEY, null);
      setMe(null);
      setStatus("anon");
      return { blocked: false };
    },
    forceSignOutKeepData: () => { stopSync(); api.setToken(null); setMe(null); setStatus("anon"); },
    updateMe: (m) => { setMe(m); void setMeta("me", m); },
    savePreferences: async (p) => { const m = await api.put<Me>("/me/preferences", p); setMe(m); await setMeta("me", m); },
    ackPrivacy: async (version) => {
      await api.post("/me/privacy-ack", { version });
      setMe((m) => { if (!m) return m; const next = { ...m, privacyAckedVersion: version }; void setMeta("me", next); return next; });
    },
    retryBoot: () => { setBootError(null); setStatus("booting"); setBootN((n) => n + 1); },
    serverConfigured: () => { setStatus("booting"); setBootN((n) => n + 1); },
  }), [status, me, mfaEnrolled, bootError, handleLogin, activate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession must be used inside <SessionProvider>");
  return c;
}

/* ---------------------------------------------------------------- role helpers */
export function hasRole(me: Me | null, roles: string[], siteId?: string | null): boolean {
  if (!me) return false;
  return me.roles.some((r) => roles.includes(r.role) && (siteId === undefined || r.siteId === null || r.siteId === siteId) && (!r.expiresAt || new Date(r.expiresAt).getTime() > Date.now()));
}
export const OFFICER_ROLES = ["site_safety_officer", "site_head", "hse_manager"];
export function isOfficer(me: Me | null, siteId?: string | null) { return hasRole(me, OFFICER_ROLES, siteId); }
export function isVerifier(me: Me | null, siteId?: string | null) { return hasRole(me, ["verifier", ...OFFICER_ROLES], siteId); }
export function isInspector(me: Me | null) { return !!me && me.roles.length > 0; }
export function isSiteHead(me: Me | null, siteId?: string | null) { return hasRole(me, ["site_head", "hse_manager"], siteId); }
export function mySiteIds(me: Me | null): string[] { return me ? me.sites.map((s) => s.id) : []; }

/** Keeps `syncNow` reachable from the session for the "Sync now" button in the logout-blocked sheet. */
export { syncNow };
