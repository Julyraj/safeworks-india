/* SafeWorks admin console — entry. React 18 + react-router (basename /admin), code-split routes. */
import React, { lazy, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "../shared/base.css";
import "./admin.css";
import { I18nProvider } from "../shared/i18n";
import { ErrorBoundary, ToastProvider, Skeleton } from "../shared/ui";
import adminEn from "../shared/i18n/admin.en.json";
import adminHi from "../shared/i18n/admin.hi.json";
import adminTa from "../shared/i18n/admin.ta.json";
import adminKn from "../shared/i18n/admin.kn.json";
import { AuthProvider, useAuth } from "./auth";
import { ScopeProvider } from "./scope";
import { AttentionProvider } from "./attention";
import { Shell } from "./shell";
import Login from "./pages/Login";

const packs = { en: adminEn, hi: adminHi, ta: adminTa, kn: adminKn };

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Attention = lazy(() => import("./pages/Attention"));
const Observations = lazy(() => import("./pages/Observations"));
const Actions = lazy(() => import("./pages/Actions"));
const Inspections = lazy(() => import("./pages/Inspections"));
const Sites = lazy(() => import("./pages/Sites"));
const Assets = lazy(() => import("./pages/Assets"));
const QrCodes = lazy(() => import("./pages/QrCodes"));
const People = lazy(() => import("./pages/People"));
const Users = lazy(() => import("./pages/Users"));
const Categories = lazy(() => import("./pages/Categories"));
const RiskMatrixPage = lazy(() => import("./pages/RiskMatrix"));
const DueDates = lazy(() => import("./pages/DueDates"));
const RuleSets = lazy(() => import("./pages/RuleSets"));
const Templates = lazy(() => import("./pages/Templates"));
const Languages = lazy(() => import("./pages/Languages"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const NotificationsLog = lazy(() => import("./pages/NotificationsLog"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Retention = lazy(() => import("./pages/Retention"));
const Settings = lazy(() => import("./pages/Settings"));
const Health = lazy(() => import("./pages/Health"));

function Gate() {
  const { stage } = useAuth();
  if (stage === "booting") return <div className="login-wrap"><div className="login-card"><Skeleton lines={4} /></div></div>;
  if (stage !== "ready") return <Login />;
  return (
    <ScopeProvider>
      <AttentionProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="attention" element={<Attention />} />
            <Route path="observations" element={<Observations />} />
            <Route path="observations/:id" element={<Observations />} />
            <Route path="actions" element={<Actions />} />
            <Route path="actions/:id" element={<Actions />} />
            <Route path="inspections" element={<Inspections />} />
            <Route path="inspections/:id" element={<Inspections />} />
            <Route path="sites" element={<Sites />} />
            <Route path="sites/new" element={<Sites />} />
            <Route path="sites/:id" element={<Sites />} />
            <Route path="sites/:id/:tab" element={<Sites />} />
            <Route path="equipment" element={<Assets />} />
            <Route path="qr" element={<QrCodes />} />
            <Route path="people" element={<People />} />
            <Route path="contractors" element={<People tab="contractors" />} />
            <Route path="users" element={<Users />} />
            <Route path="users/:id" element={<Users />} />
            <Route path="categories" element={<Categories />} />
            <Route path="risk-matrix" element={<RiskMatrixPage />} />
            <Route path="due-dates" element={<DueDates />} />
            <Route path="rule-sets" element={<RuleSets />} />
            <Route path="templates" element={<Templates />} />
            <Route path="templates/:id" element={<Templates />} />
            <Route path="schedules" element={<Templates tab="schedules" />} />
            <Route path="languages" element={<Languages />} />
            <Route path="audit-log" element={<AuditLog />} />
            <Route path="notifications-log" element={<NotificationsLog />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="retention" element={<Retention />} />
            <Route path="settings" element={<Settings />} />
            <Route path="health" element={<Health />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AttentionProvider>
    </ScopeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider packs={packs}>
      <ToastProvider>
        <ErrorBoundary>
          <BrowserRouter basename="/admin">
            <AuthProvider>
              <Gate />
            </AuthProvider>
          </BrowserRouter>
        </ErrorBoundary>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
