/* System health: server version, DB, storage driver, queues, sync rejects, app versions, job runs, backups. Auto-refreshes every minute. */
import { useI18n } from "../../shared/i18n";
import type { Health as HealthT } from "../../shared/types";
import { Bars, Button, Card, CardHead, ErrorCard, KpiTile, Pill, Skeleton } from "../../shared/ui";
import { useLoad, useInterval } from "../../shared/hooks";
import { fmtDateTime, relative } from "../../shared/format";
import { IconRefresh } from "../../shared/icons";
import { api } from "../api";
import { APP_VERSION } from "../auth";
import { KV, PageHead } from "../components";

export default function Health() {
  const { t, lang } = useI18n();
  const state = useLoad(() => api.get<HealthT>("/admin/health"), []);
  useInterval(() => state.reload(), 60_000);
  const h = state.data;
  const backupAge = h?.backups.lastAt ? Date.now() - new Date(h.backups.lastAt).getTime() : null;
  const backupTone = backupAge === null ? "red" : backupAge > 2 * 86_400_000 ? "red" : backupAge > 86_400_000 ? "orange" : "green";
  const staleJobs = (h?.lastJobRuns ?? []).filter((j) => Date.now() - new Date(j.at).getTime() > 6 * 3_600_000);
  return (
    <>
      <PageHead title={t("nav.health")} sub={h ? t("health.serverTime", { time: fmtDateTime(h.serverTime, lang) }) : undefined} tools={<Button size="sm" onClick={state.reload} loading={state.loading}><IconRefresh size={14} />{t("attention.refresh")}</Button>} />
      {state.error && !h ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!h && !state.error ? <div className="kpis">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} block className="kpi" />)}</div> : null}
      {h ? (
        <>
          <div className="kpis">
            <KpiTile value={h.db === "ok" ? t("health.ok") : t("health.error")} label={t("health.db")} tone={h.db === "ok" ? "green" : "red"} />
            <KpiTile value={h.queuedEmails} label={t("health.queuedEmails")} tone={h.queuedEmails > 50 ? "orange" : undefined} />
            <KpiTile value={h.failedNotifications24h} label={t("health.failedNotifications")} tone={h.failedNotifications24h > 0 ? "red" : "green"} n={t("health.last24h")} />
            <KpiTile value={h.syncRejected24h} label={t("health.syncRejected")} tone={h.syncRejected24h > 0 ? "orange" : "green"} n={t("health.last24h")} />
            <KpiTile value={h.backups.lastAt ? relative(h.backups.lastAt, t, lang) : t("health.never")} label={t("health.lastBackup")} tone={backupTone} n={h.backups.note} />
            <KpiTile value={h.devicesByVersion.reduce((a, d) => a + d.count, 0)} label={t("health.devices")} />
          </div>
          <div className="dash-grid">
            <Card>
              <CardHead title={t("health.server")} />
              <KV rows={[{ k: t("health.version"), v: <span className="mono-sm">{h.version}</span> }, { k: t("health.consoleVersion"), v: <span className="mono-sm">{APP_VERSION}</span> }, { k: t("health.storage"), v: <Pill tone={h.storageDriver === "disk" ? "green" : "amber"}>{t(`health.storage.${h.storageDriver}`)}</Pill> }, { k: t("health.serverTimeK"), v: fmtDateTime(h.serverTime, lang) }, { k: t("health.lastBackup"), v: h.backups.lastAt ? `${fmtDateTime(h.backups.lastAt, lang)} · ${h.backups.note}` : t("health.never") }]} />
              {h.storageDriver === "db" ? <p className="small muted" style={{ marginTop: 8 }}>{t("health.storageDbNote")}</p> : null}
            </Card>
            <Card>
              <CardHead title={t("health.appVersions")} kicker={t("health.appVersionsKicker")} />
              {h.devicesByVersion.length ? <Bars rows={h.devicesByVersion.map((d) => ({ label: d.appVersion, n: d.count }))} /> : <p className="small muted">{t("health.noDevices")}</p>}
            </Card>
            <Card className="span2">
              <CardHead title={t("health.jobs")} kicker={staleJobs.length ? t("health.staleJobs", { n: staleJobs.length }) : t("health.jobsFresh")} />
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t("health.job")}</th><th>{t("health.lastRun")}</th><th>{t("common.status")}</th></tr></thead>
                  <tbody>
                    {h.lastJobRuns.map((j) => { const age = Date.now() - new Date(j.at).getTime(); const stale = age > 6 * 3_600_000; return <tr key={j.key}><td className="mono-sm">{j.key}</td><td>{fmtDateTime(j.at, lang)} <span className="muted small">({relative(j.at, t, lang)})</span></td><td><Pill tone={stale ? "red" : "green"}>{stale ? t("health.stale") : t("health.ok")}</Pill></td></tr>; })}
                    {h.lastJobRuns.length === 0 ? <tr><td colSpan={3} className="muted">{t("health.noJobs")}</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
