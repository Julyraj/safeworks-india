/* Routes, the role-aware shell (bottom nav on phones, left rail on tablets and desktops), keyboard shortcuts,
   the Android back button and the sign-in gate. Every route is lazy and sits in its own error boundary. */
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../shared/i18n";
import { Button, ErrorBoundary, ErrorCard, Sheet, useShortcutsHelp } from "../shared/ui";
import { useHotkeys, useMediaQuery } from "../shared/hooks";
import { IconHome, IconList, IconPlus, IconClipboard, IconMore, IconBell, IconInbox, IconSettings, IconQr, IconWalk, IconLogout, IconWifiOff } from "../shared/icons";
import { isOfficer, isVerifier, useSession } from "./session";
import { useSync } from "./offline/sync";
import { useActions, useNotifications, useObservations, useRuns } from "./offline/store";
import { PageSkeleton } from "./components/common";
import { APP_VERSION } from "./api";

const Login = lazy(() => import("./pages/Login"));
const ServerAddress = lazy(() => import("./pages/ServerAddress"));
const Home = lazy(() => import("./pages/Home"));
const QuickReport = lazy(() => import("./pages/QuickReport"));
const Reports = lazy(() => import("./pages/Reports"));
const ObservationDetail = lazy(() => import("./pages/ObservationDetail"));
const Actions = lazy(() => import("./pages/Actions"));
const ActionDetail = lazy(() => import("./pages/ActionDetail"));
const Inspections = lazy(() => import("./pages/Inspections"));
const RunRoute = lazy(() => import("./pages/RunRoute"));
const Scan = lazy(() => import("./pages/Scan"));
const Outbox = lazy(() => import("./pages/Outbox"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Settings = lazy(() => import("./pages/Settings"));
const More = lazy(() => import("./pages/More"));

function RouteShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <ErrorBoundary key={loc.pathname}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  const { status, bootError, retryBoot } = useSession();
  const { t } = useI18n();
  useCapacitorBackButton();
  if (status === "booting") return <div className="splash"><div className="stack" style={{ alignItems: "center" }}><span className="spin" /><span>{t("common.loading")}</span></div></div>;
  if (status === "needs_server") return <RouteShell><ServerAddress /></RouteShell>;
  if (status === "boot_error") return <div className="page" style={{ paddingTop: 40 }}><ErrorCard error={bootError} onRetry={retryBoot} /></div>;
  if (status !== "authed") return <RouteShell><Login /></RouteShell>;
  return <Shell />;
}

function Shell() {
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const { me, logout, forceSignOutKeepData } = useSession();
  const wide = useMediaQuery("(min-width: 961px)");
  const sync = useSync();
  const { data: notifications } = useNotifications();
  const { data: actions } = useActions();
  const { data: observations } = useObservations();
  const { data: runs } = useRuns();
  const [logoutBlocked, setLogoutBlocked] = useState<number | null>(null);
  const officer = isOfficer(me);
  const verifier = isVerifier(me);

  const counts = useMemo(() => {
    const unread = notifications.filter((n) => !n.readAt).length;
    const myOpen = actions.filter((a) => a.ownerUserId === me?.id && !["completed", "verified", "cancelled"].includes(a.status));
    const overdue = myOpen.filter((a) => a.overdue).length;
    const triage = officer ? observations.filter((o) => o.status === "submitted" && !o.local).length : 0;
    const toVerify = verifier ? actions.filter((a) => a.status === "completed" && a.ownerUserId !== me?.id).length : 0;
    const inspections = runs.filter((r) => (r.status === "scheduled" || r.status === "in_progress") && (!r.inspectorUserId || r.inspectorUserId === me?.id)).length;
    return { unread, overdue, triage, toVerify, inspections, myOpen: myOpen.length };
  }, [notifications, actions, observations, runs, me?.id, officer, verifier]);

  useHotkeys([
    { keys: "n", handler: () => nav("/report") },
    { keys: "g h", handler: () => nav("/") },
    { keys: "g r", handler: () => nav("/reports") },
    { keys: "g a", handler: () => nav("/actions") },
    { keys: "g i", handler: () => nav("/inspections") },
    { keys: "g o", handler: () => nav("/outbox") },
    { keys: "/", handler: () => document.dispatchEvent(new CustomEvent("sw:focus-search")) },
  ]);
  const help = useShortcutsHelp([
    { keys: ["n"], label: t("shortcuts.new") },
    { keys: ["g", "h"], label: t("shortcuts.home") },
    { keys: ["g", "r"], label: t("shortcuts.reports") },
    { keys: ["g", "a"], label: t("shortcuts.actions") },
    { keys: ["g", "i"], label: t("shortcuts.inspections") },
    { keys: ["g", "o"], label: t("shortcuts.outbox") },
    { keys: ["/"], label: t("shortcuts.search") },
    { keys: ["↑", "↓"], label: t("shortcuts.nav") },
    { keys: ["Enter"], label: t("shortcuts.open") },
    { keys: ["Esc"], label: t("shortcuts.close") },
    { keys: ["?"], label: t("shortcuts.help") },
  ]);

  const doLogout = async () => {
    const r = await logout();
    if (r.blocked) setLogoutBlocked(r.pending);
  };

  const navItems = [
    { to: "/", icon: <IconHome />, label: t("nav.home"), end: true },
    { to: "/reports", icon: <IconList />, label: t("nav.reports"), badge: counts.triage || 0 },
    { to: "/actions", icon: <IconClipboard />, label: t("nav.actions"), badge: counts.overdue + counts.toVerify },
    { to: "/more", icon: <IconMore />, label: t("nav.more"), badge: counts.unread + (sync.failed ? 1 : 0) },
  ];

  return (
    <div className="shell">
      {wide ? (
        <nav className="rail" aria-label={t("nav.main")}>
          <div className="brand"><span className="mark">SW</span><h1>{t("app.name")}</h1></div>
          <Button variant="primary" block className="report" onClick={() => nav("/report")}><IconPlus size={20} /> {t("nav.report")}</Button>
          <NavLink to="/" end><IconHome />{t("nav.home")}</NavLink>
          <NavLink to="/reports"><IconList />{t("nav.reports")}{counts.triage ? <span className="cnt">{counts.triage}</span> : null}</NavLink>
          {officer ? <NavLink to="/reports?tab=triage"><IconInbox />{t("nav.triage")}{counts.triage ? <span className="cnt">{counts.triage}</span> : null}</NavLink> : null}
          <NavLink to="/actions"><IconClipboard />{t("nav.actions")}{counts.overdue ? <span className="cnt">{counts.overdue}</span> : null}</NavLink>
          {verifier ? <NavLink to="/actions?tab=verify"><IconWalk />{t("nav.verify")}{counts.toVerify ? <span className="cnt">{counts.toVerify}</span> : null}</NavLink> : null}
          <NavLink to="/inspections"><IconClipboard />{t("nav.inspections")}{counts.inspections ? <span className="cnt">{counts.inspections}</span> : null}</NavLink>
          <div className="section">{t("nav.more")}</div>
          <NavLink to="/scan"><IconQr />{t("nav.scan")}</NavLink>
          <NavLink to="/notifications"><IconBell />{t("nav.notifications")}{counts.unread ? <span className="cnt">{counts.unread}</span> : null}</NavLink>
          <NavLink to="/outbox"><IconInbox />{t("nav.outbox")}{sync.pending + sync.failed ? <span className="cnt">{sync.pending + sync.failed}</span> : null}</NavLink>
          <NavLink to="/settings"><IconSettings />{t("nav.settings")}</NavLink>
          <div className="user">
            <div className="sync"><span className={`dotc${!sync.online ? " off" : sync.failed ? " bad" : ""}`} />{!sync.online ? t("sync.offline") : sync.failed ? t("sync.failed", { count: sync.failed }) : sync.pending ? t("sync.waiting", { count: sync.pending }) : t("sync.allSynced")}</div>
            <b>{me?.name}</b>{me?.employeeCode} · v{APP_VERSION}
            <div style={{ marginTop: 8 }}><Button size="sm" variant="ghost" onClick={doLogout} style={{ color: "#c9d4de" }}><IconLogout size={16} /> {t("common.signOut")}</Button></div>
          </div>
        </nav>
      ) : null}
      <main>
        {!wide ? <TopBar /> : null}
        <Routes>
          <Route path="/" element={<RouteShell><Home /></RouteShell>} />
          <Route path="/report" element={<RouteShell><QuickReport /></RouteShell>} />
          <Route path="/reports" element={<RouteShell><Reports /></RouteShell>} />
          <Route path="/o/:id" element={<RouteShell><ObservationDetail /></RouteShell>} />
          <Route path="/actions" element={<RouteShell><Actions /></RouteShell>} />
          <Route path="/a/:id" element={<RouteShell><ActionDetail /></RouteShell>} />
          <Route path="/inspections" element={<RouteShell><Inspections /></RouteShell>} />
          <Route path="/inspections/runs/:id" element={<RouteShell><RunRoute /></RouteShell>} />
          <Route path="/scan" element={<RouteShell><Scan /></RouteShell>} />
          <Route path="/scan/:token" element={<RouteShell><Scan /></RouteShell>} />
          <Route path="/outbox" element={<RouteShell><Outbox /></RouteShell>} />
          <Route path="/notifications" element={<RouteShell><Notifications /></RouteShell>} />
          <Route path="/settings" element={<RouteShell><Settings onLogout={doLogout} /></RouteShell>} />
          <Route path="/more" element={<RouteShell><More onLogout={doLogout} /></RouteShell>} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/raise" element={<Navigate to="/report" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {!wide ? (
          <nav className="bottom-nav" aria-label={t("nav.main")}>
            {navItems.slice(0, 2).map((it) => <NavItem key={it.to} {...it} />)}
            <NavLink to="/report" aria-label={t("nav.report")} className={loc.pathname === "/report" ? "fab on" : "fab"}><IconPlus /></NavLink>
            {navItems.slice(2).map((it) => <NavItem key={it.to} {...it} />)}
          </nav>
        ) : null}
      </main>
      {help}
      {logoutBlocked !== null ? (
        <Sheet title={t("logout.blockedTitle")} onClose={() => setLogoutBlocked(null)} footer={
          <>
            <Button onClick={() => setLogoutBlocked(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={sync.syncing} onClick={async () => { await sync.syncNow(); const r = await logout(); if (r.blocked) setLogoutBlocked(r.pending); else setLogoutBlocked(null); }}>{t("sync.now")}</Button>
          </>
        }>
          <p>{t("logout.blockedBody", { count: logoutBlocked })}</p>
          {!sync.online ? <p className="small muted"><IconWifiOff size={14} /> {t("logout.blockedOffline")}</p> : null}
          <p className="small muted">{t("logout.keepHint")}</p>
          <Button size="sm" variant="ghost" onClick={() => { setLogoutBlocked(null); forceSignOutKeepData(); }}>{t("logout.lockInstead")}</Button>
        </Sheet>
      ) : null}
    </div>
  );
}

function NavItem({ to, icon, label, end, badge }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink to={to} end={end}>
      {icon}
      <span>{label}</span>
      {badge ? <span className="badge" aria-label={String(badge)}>{badge > 99 ? "99+" : badge}</span> : null}
    </NavLink>
  );
}

function TopBar() {
  const { t } = useI18n();
  const loc = useLocation();
  const nav = useNavigate();
  const sync = useSync();
  const { data: notifications } = useNotifications();
  const unread = notifications.filter((n) => !n.readAt).length;
  const title = useMemo(() => {
    const p = loc.pathname;
    if (p === "/") return t("app.name");
    if (p.startsWith("/report")) return t("report.title");
    if (p.startsWith("/reports")) return t("nav.reports");
    if (p.startsWith("/o/")) return t("obs.title");
    if (p.startsWith("/actions")) return t("nav.actions");
    if (p.startsWith("/a/")) return t("action.title");
    if (p.startsWith("/inspections")) return t("nav.inspections");
    if (p.startsWith("/scan")) return t("nav.scan");
    if (p.startsWith("/outbox")) return t("nav.outbox");
    if (p.startsWith("/notifications")) return t("nav.notifications");
    if (p.startsWith("/settings")) return t("nav.settings");
    return t("nav.more");
  }, [loc.pathname, t]);
  return (
    <header className="topbar">
      <div className="brand grow"><span className="mark">SW</span><div style={{ minWidth: 0 }}><h1 className="truncate">{title}</h1></div></div>
      {!sync.online ? <span className="sub" title={t("sync.offline")}><IconWifiOff size={18} /></span> : null}
      <Button variant="ghost" icon onClick={() => nav("/scan")} aria-label={t("nav.scan")}><IconQr /></Button>
      <Button variant="ghost" icon onClick={() => nav("/notifications")} aria-label={t("nav.notifications")} style={{ position: "relative" }}>
        <IconBell />{unread ? <span className="badge">{unread > 99 ? "99+" : unread}</span> : null}
      </Button>
    </header>
  );
}

/** Android hardware back: close an open sheet, else go back, else leave the app (as the old SafeWorks app did). */
function useCapacitorBackButton() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { App?: { addListener: (ev: string, fn: (s: { canGoBack: boolean }) => void) => Promise<{ remove: () => void }> | { remove: () => void }; exitApp: () => void } } } }).Capacitor;
    const AppPlugin = cap?.isNativePlatform?.() ? cap.Plugins?.App : undefined;
    if (!AppPlugin) return;
    let handle: { remove: () => void } | null = null;
    const res = AppPlugin.addListener("backButton", ({ canGoBack }) => {
      if (document.querySelector(".sheet, .scrim")) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return; }
      if (loc.pathname !== "/" && (canGoBack || window.history.length > 1)) nav(-1);
      else if (loc.pathname !== "/") nav("/");
      else AppPlugin.exitApp();
    });
    Promise.resolve(res).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, [nav, loc.pathname]);
}
