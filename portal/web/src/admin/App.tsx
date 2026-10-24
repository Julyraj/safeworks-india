import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import type { Me } from "../shared/types";
import { Spinner } from "../shared/ui";
import {
  IconBriefcase, IconChart, IconDownload, IconLayers, IconList, IconLog, IconLogout, IconMore, IconSettings, IconSite, IconUsers, IconX,
} from "../shared/icons";
import { api, Auth, AuthCtx, isAdminRole, useAuth } from "./ctx";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Overview from "./pages/Overview";
import Observations from "./pages/Observations";
import ObservationPage from "./pages/ObservationPage";
import Sites from "./pages/Sites";
import Users from "./pages/Users";
import Contractors from "./pages/Contractors";
import MasterLists from "./pages/MasterLists";
import Settings from "./pages/Settings";
import Audit from "./pages/Audit";
import Reports from "./pages/Reports";

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: <IconChart /> },
  { to: "/observations", label: "Observations", icon: <IconList /> },
  { to: "/sites", label: "Sites & areas", icon: <IconSite /> },
  { to: "/users", label: "Users & passwords", icon: <IconUsers /> },
  { to: "/contractors", label: "Contractors", icon: <IconBriefcase /> },
  { to: "/master", label: "Master lists", icon: <IconLayers /> },
  { to: "/settings", label: "Settings", icon: <IconSettings /> },
  { to: "/audit", label: "Audit log", icon: <IconLog />, adminOnly: true },
  { to: "/reports", label: "Reports & export", icon: <IconDownload /> },
];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);

  const signOutLocal = useCallback(() => {
    api.setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    api.onUnauthorized(signOutLocal);
    if (!api.token()) {
      setBooting(false);
      return;
    }
    api
      .get<Me>("/api/me")
      .then(setMe)
      .catch(() => signOutLocal())
      .finally(() => setBooting(false));
  }, [signOutLocal]);

  const ctx: AuthCtx | null = useMemo(
    () =>
      me
        ? {
            me,
            canWrite: isAdminRole(me),
            refreshMe: async () => setMe(await api.get<Me>("/api/me")),
            logout: async () => {
              try {
                await api.post("/api/auth/logout");
              } catch {
                /* session may already be gone */
              }
              signOutLocal();
            },
          }
        : null,
    [me, signOutLocal],
  );

  if (booting) return <Spinner label="Opening the admin console" />;
  if (!me || !ctx) {
    return (
      <Login
        onLogin={(token, user) => {
          api.setToken(token);
          setMe(user);
        }}
      />
    );
  }
  if (me.mustChangePassword) {
    return (
      <Auth.Provider value={ctx}>
        <ChangePassword />
      </Auth.Provider>
    );
  }
  return (
    <Auth.Provider value={ctx}>
      <Layout />
    </Auth.Provider>
  );
}

function NavLinks({ canWrite, onNavigate }: { canWrite: boolean; onNavigate?: () => void }) {
  return (
    <>
      {NAV.filter((n) => !n.adminOnly || canWrite).map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={onNavigate}>
          {n.icon}
          <span>{n.label}</span>
        </NavLink>
      ))}
    </>
  );
}

function Foot({ me, company, onLogout }: { me: Me; company: string; onLogout: () => void }) {
  const roleText = me.roles
    .filter((r) => r.siteId === null)
    .map((r) => r.roleLabel)
    .join(", ");
  return (
    <div className="foot">
      <span>{company}</span>
      <span>
        Signed in as <strong>{me.name}</strong> ({me.employeeId})
        {roleText ? <><br />{roleText}</> : null}
      </span>
      <button className="signout" onClick={onLogout}>
        <IconLogout size={18} /> Sign out
      </button>
    </div>
  );
}

function Layout() {
  const { me, canWrite, logout } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  const current = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)));

  return (
    <div className="shell with-side admin">
      <aside className="side" aria-label="Admin navigation">
        <div className="brand">
          <span className="mark" aria-hidden /> SafeWorks admin
        </div>
        <NavLinks canWrite={canWrite} />
        <Foot me={me} company={me.company} onLogout={logout} />
      </aside>
      <div className="content-col">
        <header className="topbar a-topbar">
          <button className="icon-btn" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <IconMore />
          </button>
          <div className="brand">
            <span className="mark" aria-hidden /> {current?.label ?? "SafeWorks admin"}
          </div>
        </header>
        {drawer && (
          <>
            <div className="a-drawer-scrim" onClick={() => setDrawer(false)} />
            <nav className="a-drawer" aria-label="Admin navigation">
              <div className="spread">
                <div className="brand">
                  <span className="mark" aria-hidden /> SafeWorks admin
                </div>
                <button className="icon-btn" aria-label="Close menu" onClick={() => setDrawer(false)}>
                  <IconX />
                </button>
              </div>
              <NavLinks canWrite={canWrite} onNavigate={() => setDrawer(false)} />
              <Foot me={me} company={me.company} onLogout={logout} />
            </nav>
          </>
        )}
        <main className="main" id="main">
          {!canWrite && (
            <div className="alert readonly-note">You have read-only access as a management viewer. Ask an admin to make changes.</div>
          )}
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/observations" element={<Observations />} />
            <Route path="/observations/:id" element={<ObservationPage />} />
            <Route path="/sites" element={<Sites />} />
            <Route path="/users" element={<Users />} />
            <Route path="/contractors" element={<Contractors />} />
            <Route path="/master" element={<MasterLists />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audit" element={canWrite ? <Audit /> : <Navigate to="/" replace />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
