/* QR public form entry (/q/<token>, /q/status/<caseNo>): no login, no router — the path is read once. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/base.css";
import "../field/field.css";
import { I18nProvider } from "../shared/i18n";
import { ErrorBoundary, ToastProvider } from "../shared/ui";
import { QrApp } from "./QrApp";
import qrEn from "../shared/i18n/qr.en.json";
import qrHi from "../shared/i18n/qr.hi.json";
import qrTa from "../shared/i18n/qr.ta.json";
import qrKn from "../shared/i18n/qr.kn.json";

const packs = { en: qrEn, hi: qrHi, ta: qrTa, kn: qrKn };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider packs={packs}>
      <ToastProvider>
        <ErrorBoundary>
          <QrApp />
        </ErrorBoundary>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
