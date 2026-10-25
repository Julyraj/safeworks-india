/* Console layout: left rail, top bar with the site filter, search, language and account; keyboard shortcuts; auditor banner. */
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useI18n, LANGS, LANG_NAMES } from "../shared/i18n";
import type { Lang } from "../shared/types";
import { Banner, Button, ErrorBoundary, Field, Form, Input, Select, Sheet, Skeleton, useShortcutsHelp, useToast } from "../shared/ui";
import { useHotkeys } from "../shared/hooks";
import { fmtDate, initials } from "../shared/format";
import {
  IconAlert, IconBell, IconBook, IconCalendar, IconChart, IconClipboard, IconClock, IconFlag, IconGlobe, IconHelmet, IconHome, IconKey, IconLayers, IconList, IconLock,
  IconLog, IconLogout, IconMenu, IconQr, IconSearch, IconSettings, IconShield, IconSite, IconTool, IconUsers, IconWalk, IconHistory,
} from "../shared/icons";
import { useAuth, APP_VERSION } from "./auth";
import { useScope } from "./scope";
import { useAttention } from "./attention";
import { errMessage } from "./api";

interface NavItem { to: string; key: string; icon: ReactNode; show: boolean; badge?: number; badgeTone?: "red" | "amber" }

export function Shell() {
  const { t, lang, setLang } = useI18n();
  const { me, perms, logout } = useAuth();
  const { siteId, setSiteId, sites } = useScope();
  const attention = useAttention();
  const nav = useNavigate();
  const loc = useLocation();
  const [railOpen, setRailOpen] = useState(false);
  const [account, setAccount] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [jump, setJump] = useState("");

  useEffect(() => { setRailOpen(false); }, [loc.pathname]);

  const cfg = perms.isAdmin || perms.isHse;
  const officer = perms.canTriage;
  const sections: { key: string; items: NavItem[] }[] = useMemo(() => [
    { key: "overview", items: [
      { to: "/", key: "dashboard", icon: <IconChart />, show: true },
      { to: "/attention", key: "attention", icon: <IconFlag />, show: true, badge: attention.urgent || undefined, badgeTone: "red" },
    ] },
    { key: "registers", items: [
      { to: "/observations", key: "observations", icon: <IconList />, show: true },
      { to: "/actions", key: "actions", icon: <IconClipboard />, show: true },
      { to: "/inspections", key: "inspections", icon: <IconWalk />, show: true },
    ] },
    { key: "configure", items: [
      { to: "/sites", key: "sites", icon: <IconSite />, show: cfg || officer },
      { to: "/equipment", key: "equipment", icon: <IconTool />, show: cfg || officer },
      { to: "/qr", key: "qr", icon: <IconQr />, show: cfg || officer },
      { to: "/people", key: "people", icon: <IconHelmet />, show: cfg || officer },
      { to: "/users", key: "users", icon: <IconUsers />, show: perms.isAdmin || perms.isHse },
      { to: "/categories", key: "categories", icon: <IconLayers />, show: cfg },
      { to: "/risk-matrix", key: "riskMatrix", icon: <IconAlert />, show: cfg },
      { to: "/due-dates", key: "dueDates", icon: <IconClock />, show: cfg },
      { to: "/rule-sets", key: "ruleSets", icon: <IconBook />, show: cfg },
      { to: "/templates", key: "templates", icon: <IconClipboard />, show: cfg || officer },
      { to: "/schedules", key: "schedules", icon: <IconCalendar />, show: cfg || officer },
      { to: "/languages", key: "languages", icon: <IconGlobe />, show: perms.isAdmin },
    ] },
    { key: "oversight", items: [
      { to: "/audit-log", key: "auditLog", icon: <IconLog />, show: cfg || perms.isAuditor || officer },
      { to: "/notifications-log", key: "notificationsLog", icon: <IconBell />, show: cfg || perms.isAuditor },
      { to: "/privacy", key: "privacy", icon: <IconShield />, show: cfg },
      { to: "/retention", key: "retention", icon: <IconHistory />, show: perms.isAdmin },
      { to: "/settings", key: "settings", icon: <IconSettings />, show: perms.isAdmin },
      { to: "/health", key: "health", icon: <IconLock />, show: perms.isAdmin },
    ] },
  ], [cfg, officer, perms, attention.urgent]);

  const focusSearch = () => {
    const pageSearch = document.querySelector<HTMLInputElement>("[data-register-search]");
    (pageSearch ?? searchRef.current)?.focus();
    (pageSearch ?? searchRef.current)?.select();
  };
  useHotkeys([
    { keys: "g d", handler: () => nav("/") },
    { keys: "g o", handler: () => nav("/observations") },
    { keys: "g a", handler: () => nav("/actions") },
    { keys: "g i", handler: () => nav("/inspections") },
    { keys: "g u", handler: () => nav("/users") },
    { keys: "g s", handler: () => nav("/sites") },
    { keys: "g t", handler: () => nav("/attention") },
    { keys: "/", handler: focusSearch },
    { keys: "Escape", handler: () => { (document.activeElement as HTMLElement | null)?.blur?.(); setRailOpen(false); }, global: true },
  ]);
  const help = useShortcutsHelp([
    { keys: ["g", "d"], label: t("nav.dashboard") }, { keys: ["g", "t"], label: t("nav.attention") }, { keys: ["g", "o"], label: t("nav.observations") }, { keys: ["g", "a"], label: t("nav.actions") },
    { keys: ["g", "i"], label: t("nav.inspections") }, { keys: ["g", "u"], label: t("nav.users") }, { keys: ["g", "s"], label: t("nav.sites") },
    { keys: ["/"], label: t("shortcuts.search") }, { keys: ["j", "k"], label: t("shortcuts.nav") }, { keys: ["Enter"], label: t("shortcuts.open") }, { keys: ["Esc"], label: t("shortcuts.close") }, { keys: ["?"], label: t("shortcuts.help") },
  ]);

  const onJump = () => {
    const q = jump.trim();
    if (!q) return;
    const m = q.toUpperCase().match(/-(OBS|ACT|INS)-/);
    const target = m?.[1] === "ACT" ? "/actions" : m?.[1] === "INS" ? "/inspections" : "/observations";
    nav(`${target}?q=${encodeURIComponent(q)}`);
    setJump("");
  };

  const current = sections.flatMap((s) => s.items).find((i) => (i.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(i.to)));

  return (
    <div className="console">
      <div className="shell">
        {railOpen ? <div className="rail-scrim" onClick={() => setRailOpen(false)} aria-hidden /> : null}
        <aside className={`rail${railOpen ? " open" : ""}`} aria-label={t("nav.main")}>
          <div className="brand"><span className="mark">SW</span><h1>{t("app.console")}</h1></div>
          <nav>
            {sections.map((s) => {
              const items = s.items.filter((i) => i.show);
              if (!items.length) return null;
              return (
                <div key={s.key}>
                  <div className="section">{t(`nav.section.${s.key}`)}</div>
                  {items.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.to === "/"}>
                      {i.icon}<span>{t(`nav.${i.key}`)}</span>
                      {i.badge ? <span className={`cnt ${i.badgeTone ?? ""}`}>{i.badge > 99 ? "99+" : i.badge}</span> : null}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="foot">{me?.org.name} · v{APP_VERSION}</div>
        </aside>
        <main>
          <header className="console-top">
            <Button className="rail-toggle" variant="ghost" icon onClick={() => setRailOpen((o) => !o)} aria-label={t("nav.main")} aria-expanded={railOpen}><IconMenu /></Button>
            <span className="crumb">{current ? t(`nav.${current.key}`) : t("app.console")}</span>
            <form className="search" onSubmit={(e) => { e.preventDefault(); onJump(); }} role="search">
              <IconSearch />
              <input ref={searchRef} className="input" value={jump} onChange={(e) => setJump(e.target.value)} placeholder={t("top.jump")} aria-label={t("top.jump")} />
              <kbd aria-hidden>/</kbd>
            </form>
            <span className="spacer" />
            <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label={t("top.siteFilter")}>
              <option value="">{t("top.allSites")}</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name.en}</option>)}
            </Select>
            <Select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("common.language")}>
              {LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
            </Select>
            <button type="button" className="who btn ghost" onClick={() => setAccount(true)} aria-label={t("top.account")}>
              <span className="avatar">{initials(me?.name ?? "")}</span>
              <span className="name">{me?.name}</span>
            </button>
          </header>
          <div className="content">
            {perms.readOnly ? (
              <Banner tone="info" icon={<IconLock size={16} />}>
                {t("auditor.readOnly", { date: perms.auditorExpiresAt ? fmtDate(perms.auditorExpiresAt, lang) : t("auditor.noExpiry") })}
              </Banner>
            ) : null}
            <ErrorBoundary key={loc.pathname}>
              <Suspense fallback={<div className="stack"><Skeleton lines={2} /><Skeleton block /><Skeleton block /></div>}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {help}
      {account ? <AccountSheet onClose={() => setAccount(false)} onSignOut={async () => { setAccount(false); await logout(); }} /> : null}
    </div>
  );
}

function AccountSheet({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const { me, perms, changePassword } = useAuth();
  const { siteName } = useScope();
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const staff = perms.roles.some((r) => ["admin", "hse_manager", "site_head", "site_safety_officer", "auditor"].includes(r));
  const minLen = staff ? 12 : 8;
  const problem = next && (next.length < minLen || !/[a-zA-Z]/.test(next) || !/\d/.test(next)) ? t("login.passwordRule", { min: minLen }) : next && again && next !== again ? t("login.passwordMismatch") : "";
  return (
    <Sheet title={me?.name ?? ""} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.close")}</Button><Button variant="danger" onClick={onSignOut}><IconLogout size={16} />{t("common.signOut")}</Button></>}>
      <dl className="dl">
        <dt>{t("users.employeeCode")}</dt><dd>{me?.employeeCode}</dd>
        <dt>{t("users.email")}</dt><dd>{me?.email || "—"}</dd>
        <dt>{t("users.roles")}</dt><dd>{me?.roles.map((r, i) => <div key={i}>{t(`role.${r.role}`)} · {r.siteId ? siteName(r.siteId) : t("role.allSites")}{r.expiresAt ? ` · ${t("users.expires")} ${fmtDate(r.expiresAt, lang)}` : ""}</div>)}</dd>
        <dt>{t("users.mfa")}</dt><dd>{me?.mfaEnabled ? t("common.yes") : t("common.no")}</dd>
      </dl>
      <h3 style={{ marginTop: 18 }}><IconKey size={16} style={{ display: "inline", verticalAlign: "-2px" }} /> {t("login.changePassword")}</h3>
      <Form onSubmit={async () => {
        if (problem || !cur || !next) { setErr(problem || t("error.validation")); return; }
        setBusy(true); setErr("");
        try { await changePassword(cur, next); toast.success(t("login.passwordChanged")); setCur(""); setNext(""); setAgain(""); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
      }}>
        <Field label={t("login.currentPassword")} required><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label={t("login.newPassword")} required hint={t("login.passwordRule", { min: minLen })} error={problem || err}><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label={t("login.repeatPassword")} required><Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!cur || !next || !!problem}>{t("login.changePassword")}</Button>
      </Form>
      <p className="small muted" style={{ marginTop: 14 }}><IconHome size={12} style={{ display: "inline" }} /> {me?.org.name}</p>
    </Sheet>
  );
}
