import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { IconApprove, IconBell, IconChart, IconHome, IconList, IconMore, IconPhone, IconPlus, IconWalk } from "../shared/icons";
import { useToast } from "../shared/ui";
import { flush, onOutbox } from "./outbox";
import { api, useSession } from "./session";

export function Layout({ children }: { children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  const toast = useToast();
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [unread, setUnread] = useState(s.me.unreadNotifications);

  useEffect(() => onOutbox(setQueued), []);
  useEffect(() => {
    const up = () => {
      setOnline(true);
      flush(api).then((n) => n && toast(`${n} saved point${n === 1 ? "" : "s"} uploaded`));
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const t = setInterval(() => flush(api).then((n) => n && toast(`${n} saved point${n === 1 ? "" : "s"} uploaded`)), 30_000);
    flush(api);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(t);
    };
  }, [toast]);

  // Refresh the unread count when moving between pages (cheap; at most once a minute).
  useEffect(() => {
    let alive = true;
    const last = Number(sessionStorage.getItem("sw:unreadAt") || 0);
    if (Date.now() - last > 60_000) {
      sessionStorage.setItem("sw:unreadAt", String(Date.now()));
      api
        .get<{ unreadNotifications: number }>("/api/me")
        .then((m) => alive && setUnread(m.unreadNotifications))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [loc.pathname]);

  const raise = s.canRaiseAnywhere;
  const viewAll = s.sites.some((x) => x.can.viewAll);
  const approve = s.sites.some((x) => x.can.manage);

  const tabs: { to: string; label: string; icon: ReactNode; raise?: boolean; end?: boolean }[] = raise
    ? [
        { to: "/", label: "Home", icon: <IconHome />, end: true },
        { to: "/observations", label: "Points", icon: <IconList /> },
        { to: "/raise", label: "Raise", icon: <IconPlus size={26} />, raise: true },
        { to: "/approvals", label: "Approvals", icon: <IconApprove /> },
        { to: "/more", label: "More", icon: <IconMore /> },
      ]
    : [
        { to: "/", label: "Home", icon: <IconHome />, end: true },
        { to: "/observations", label: s.isSupervisorOnly ? "My points" : "Points", icon: <IconList /> },
        viewAll ? { to: "/dashboard", label: "Dashboard", icon: <IconChart /> } : { to: "/notifications", label: "Alerts", icon: <IconBell /> },
        { to: "/sos", label: "SOS", icon: <IconPhone /> },
        { to: "/more", label: "More", icon: <IconMore /> },
      ];

  return (
    <div className="shell with-side">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <span className="mark" aria-hidden /> SafeWorks
        </div>
        {raise && (
          <Link to="/raise" className="btn btn-primary side-raise" style={{ color: "var(--hivis-ink)", boxShadow: "none" }}>
            <IconPlus /> Raise observation
          </Link>
        )}
        <NavLink to="/" end>
          <IconHome /> Home
        </NavLink>
        <NavLink to="/observations">
          <IconList /> {s.isSupervisorOnly ? "My points" : "Observations"}
        </NavLink>
        {raise && (
          <NavLink to="/walks">
            <IconWalk /> Safety walks
          </NavLink>
        )}
        {approve && (
          <NavLink to="/approvals">
            <IconApprove /> Approvals
          </NavLink>
        )}
        {viewAll && (
          <NavLink to="/dashboard">
            <IconChart /> Site dashboard
          </NavLink>
        )}
        <NavLink to="/notifications">
          <IconBell /> Notifications {unread > 0 && <span className="pill" style={{ marginLeft: "auto", background: "var(--hivis)", color: "var(--hivis-ink)", border: 0 }}>{unread}</span>}
        </NavLink>
        <NavLink to="/sos">
          <IconPhone /> SOS numbers
        </NavLink>
        <NavLink to="/more">
          <IconMore /> More
        </NavLink>
        <div className="foot">
          {s.me.name}
          <br />
          {s.me.employeeId} · {s.me.company}
        </div>
      </nav>
      <div className="content-col">
        <header className="topbar">
          <div className="brand">
            <span className="mark" aria-hidden /> SafeWorks
          </div>
          <div className="grow" />
          {s.sites.length > 1 ? (
            <select className="site-pick" value={s.site?.id ?? ""} onChange={(e) => s.setSiteId(e.target.value)} aria-label="Current site">
              {s.sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="small" style={{ opacity: 0.85 }}>
              {s.site?.name}
            </span>
          )}
          <Link to="/notifications" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} style={{ color: "#fff" }}>
            <IconBell />
            {unread > 0 && <span className="badge-dot">{unread > 99 ? "99+" : unread}</span>}
          </Link>
        </header>
        {(!online || queued > 0) && (
          <div className="offline-bar" role="status">
            {!online && <strong>Offline.</strong>}
            {queued > 0 ? (
              <span>
                {queued} point{queued === 1 ? "" : "s"} saved on this phone, waiting to upload.{" "}
                <Link to="/outbox">View</Link>
              </span>
            ) : (
              <span>New points are kept on this phone and uploaded when you are back online.</span>
            )}
          </div>
        )}
        <main className="main" id="main">
          {children}
        </main>
        <nav className="tabbar" aria-label="Main">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `${isActive ? "active" : ""} ${t.raise ? "raise" : ""}`}>
              {t.raise ? <span className="raise-btn">{t.icon}</span> : t.icon}
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
