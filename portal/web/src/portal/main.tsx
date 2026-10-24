import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "../shared/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { isNative } from "../shared/api";
import { ToastProvider } from "../shared/ui";
import { Layout } from "./Layout";
import { SessionProvider } from "./session";
import { ChangePassword, Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Approvals, Observations } from "./pages/Observations";
import { Raise } from "./pages/Raise";
import { Walks, WalkDetail } from "./pages/Walks";
import { SiteDashboard } from "./pages/Dashboard";
import { More, Notifications, ObservationPage, Outbox, Sos } from "./pages/Misc";

function App() {
  return (
    <SessionProvider
      signedOut={(done) => <Login onDone={done} />}
      mustChange={(me, done) => <ChangePassword me={me} onDone={done} forced />}
      failed={(msg, retry) => (
        <main className="login-wrap">
          <div className="login-card stack">
            <h1>Can't reach SafeWorks</h1>
            <p>{msg}</p>
            <button className="btn btn-primary" onClick={retry}>
              Try again
            </button>
          </div>
        </main>
      )}
    >
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/observations" element={<Observations />} />
          <Route path="/o/:id" element={<ObservationPage />} />
          <Route path="/raise" element={<Raise />} />
          <Route path="/walks" element={<Walks />} />
          <Route path="/walks/:id" element={<WalkDetail />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/dashboard" element={<SiteDashboard />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/sos" element={<Sos />} />
          <Route path="/outbox" element={<Outbox />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </SessionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Installable web app: cache the app shell so it opens without a network.
if (!isNative && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
