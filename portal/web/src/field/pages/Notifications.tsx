/* Notification inbox from the pull: read / acknowledge (critical items need an ack), open the linked record. */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Notification } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, EmptyState, Pill, ListSkeleton, useToast } from "../../shared/ui";
import { IconBell, IconAlert } from "../../shared/icons";
import { relative } from "../../shared/format";
import { errorKey } from "../../shared/api";
import { api } from "../api";
import { useNotifications } from "../offline/store";
import { patchNotification } from "../offline/db";
import { useOnlineOnly } from "../components/common";

export default function Notifications() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading } = useNotifications();
  const { online } = useOnlineOnly();
  const [busy, setBusy] = useState<number | null>(null);
  const unread = data.filter((n) => !n.readAt).length;

  const open = async (n: Notification) => {
    if (!n.readAt) { void patchNotification(n.id, { readAt: new Date().toISOString() }); api.post(`/me/notifications/${n.id}/read`, {}).catch(() => { /* will be reflected on the next pull */ }); }
    const link = n.link || "";
    const m = link.match(/\/(o|a|inspections\/runs)\/([^/?#]+)/);
    if (m) nav(`/${m[1]}/${m[2]}`);
    else if (n.recordType === "observation" && n.recordId) nav(`/o/${n.recordId}`);
    else if (n.recordType === "action" && n.recordId) nav(`/a/${n.recordId}`);
    else if (n.recordType === "inspection_run" && n.recordId) nav(`/inspections/runs/${n.recordId}`);
  };
  const ack = async (n: Notification) => {
    setBusy(n.id);
    try { await api.post(`/me/notifications/${n.id}/ack`, {}); await patchNotification(n.id, { ackedAt: new Date().toISOString(), readAt: n.readAt ?? new Date().toISOString(), status: "acknowledged" }); toast.success(t("notif.acked")); }
    catch (e) { const { key, message } = errorKey(e); toast.error(key === "error.generic" ? message : t(key)); }
    finally { setBusy(null); }
  };
  const readAll = async () => {
    try { await api.post("/me/notifications/read-all", {}); for (const n of data) if (!n.readAt) await patchNotification(n.id, { readAt: new Date().toISOString() }); }
    catch (e) { const { key, message } = errorKey(e); toast.error(key === "error.generic" ? message : t(key)); }
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <h1>{t("nav.notifications")}</h1>
        {unread ? <Button size="sm" onClick={readAll} disabled={!online} title={online ? undefined : t("common.needsConnection")}>{t("notif.readAll")}</Button> : null}
      </div>
      {loading ? <ListSkeleton rows={4} /> : data.length === 0 ? <EmptyState icon={<IconBell />} title={t("notif.empty")} body={t("notif.emptyBody")} /> : (
        <div className="stack" style={{ gap: 8 }}>
          {data.map((n) => (
            <div key={n.id} className={`notif${!n.readAt ? " unread" : ""}${n.critical ? " critical" : ""}`} role="button" tabIndex={0} onClick={() => void open(n)} onKeyDown={(e) => { if (e.key === "Enter") void open(n); }} data-row>
              <div>
                <div style={{ fontWeight: 600 }}>{n.critical ? <IconAlert size={14} style={{ color: "var(--red)", verticalAlign: "-2px" }} /> : null} {n.title}</div>
                <div className="small">{n.body}</div>
                <div className="small muted">{relative(n.createdAt, t, lang)} · {t(`notif.event.${n.eventType}`) === `notif.event.${n.eventType}` ? n.eventType.replace(/_/g, " ") : t(`notif.event.${n.eventType}`)}</div>
              </div>
              <div className="stack" style={{ alignItems: "flex-end", gap: 4 }}>
                {n.critical && !n.ackedAt ? <Button size="sm" variant="danger" loading={busy === n.id} disabled={!online} title={online ? undefined : t("common.needsConnection")} onClick={(e) => { e.stopPropagation(); void ack(n); }}>{t("obs.ack")}</Button> : n.ackedAt ? <Pill tone="green">{t("notif.ackedLabel")}</Pill> : null}
                {!n.readAt ? <Pill tone="blue" dot>{t("notif.new")}</Pill> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
