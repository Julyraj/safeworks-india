/* Field app entry: providers, router, service worker, Capacitor hooks. Screens are code-split in app.tsx. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "../shared/base.css";
import "./field.css";
import { I18nProvider } from "../shared/i18n";
import { ErrorBoundary, ToastProvider } from "../shared/ui";
import { isNative } from "../shared/api";
import { SessionProvider } from "./session";
import { App } from "./app";
import fieldEn from "../shared/i18n/field.en.json";
import fieldHi from "../shared/i18n/field.hi.json";
import fieldTa from "../shared/i18n/field.ta.json";
import fieldKn from "../shared/i18n/field.kn.json";

const packs = { en: fieldEn, hi: fieldHi, ta: fieldTa, kn: fieldKn };

if ("serviceWorker" in navigator && !isNative && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => { navigator.serviceWorker?.register("/sw.js").catch((e) => console.warn("[safeworks] service worker not registered", e)); });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider packs={packs}>
      <ToastProvider>
        <ErrorBoundary>
          <SessionProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SessionProvider>
        </ErrorBoundary>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
