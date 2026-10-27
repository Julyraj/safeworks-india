/* More: the rest of the app on phones — inspections, scan, notifications, outbox, settings, library, sign out. */
import { Link } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import { IconClipboard, IconQr, IconBell, IconInbox, IconSettings, IconBook, IconLogout, IconWalk, IconKeyboard } from "../../shared/icons";
import { useSession, isOfficer, isVerifier } from "../session";
import { useSync } from "../offline/sync";
import { useNotifications, useObservations, useActions } from "../offline/store";
import { SyncBanner } from "../components/common";
import { useMediaQuery } from "../../shared/hooks";
import { APP_VERSION } from "../api";

export default function More({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();
  const { me } = useSession();
  const sync = useSync();
  const { data: notifications } = useNotifications();
  const { data: observations } = useObservations();
  const { data: actions } = useActions();
  const wide = useMediaQuery("(min-width: 961px)");
  const unread = notifications.filter((n) => !n.readAt).length;
  const triage = isOfficer(me) ? observations.filter((o) => o.status === "submitted" && !o.local).length : 0;
  const verify = isVerifier(me) ? actions.filter((a) => a.status === "completed" && a.ownerUserId !== me?.id).length : 0;
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <SyncBanner />
      <div className="page-head"><div><h1>{me?.name}</h1><div className="small muted">{me?.employeeCode} · {me?.roles.map((r) => t(`role.${r.role}`)).join(", ")}</div></div></div>
      <div className="more-grid">
        {triage ? <Link to="/reports?tab=triage"><IconInbox /> {t("nav.triage")}<span className="cnt">{triage}</span></Link> : null}
        {verify ? <Link to="/actions?tab=verify"><IconWalk /> {t("nav.verify")}<span className="cnt">{verify}</span></Link> : null}
        <Link to="/inspections"><IconClipboard /> {t("nav.inspections")}</Link>
        <Link to="/scan"><IconQr /> {t("nav.scan")}</Link>
        <Link to="/notifications"><IconBell /> {t("nav.notifications")}{unread ? <span className="cnt">{unread}</span> : null}</Link>
        <Link to="/outbox"><IconInbox /> {t("nav.outbox")}{sync.pending + sync.failed ? <span className="cnt">{sync.pending + sync.failed}</span> : null}</Link>
        <Link to="/settings"><IconSettings /> {t("nav.settings")}</Link>
        <a href="/library/" target="_blank" rel="noreferrer"><IconBook /> {t("settings.library")}</a>
        {wide ? <button type="button" onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }))}><IconKeyboard /> {t("shortcuts.title")}</button> : null}
        <button type="button" onClick={onLogout}><IconLogout /> {t("common.signOut")}</button>
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>{t("app.name")} v{APP_VERSION}</p>
    </div>
  );
}
