/* Charts (2.1): three levels of the same picture — My charts (my reports and my actions), Department (reports by named
   members of my department and actions assigned to it) and Site (everything at my sites, plus the department table).
   Counts only, never names. Needs the server (charts are not kept offline). Officers can download the whole period as
   an Excel workbook (summary, reports, actions, departments). */
import { useState } from "react";
import type { InsightLevel, Insights as InsightsT } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Bars, Button, Card, CardHead, Chip, ChipBar, EmptyState, ErrorCard, KpiTile, Select, Skeleton, Tabs, useToast } from "../../shared/ui";
import { useLoad, useLocalState } from "../../shared/hooks";
import { ApiError } from "../../shared/api";
import { fmtNumber, pct } from "../../shared/format";
import { IconDownload, IconWifiOff } from "../../shared/icons";
import { TrendChart } from "../../shared/charts";
import { useSession, isOfficer } from "../session";
import { api, useRefData } from "../offline/store";
import { useSync } from "../offline/sync";
import { SyncBanner } from "../components/common";

const DAYS = [30, 90, 365] as const;
type Days = (typeof DAYS)[number];
const TYPE_COLOUR: Record<string, string> = { good_practice: "var(--green)", unsafe_act: "var(--amber)", unsafe_condition: "var(--orange)", near_miss: "var(--red)" };
const BAND_COLOUR: Record<string, string> = { extreme: "var(--red)", high: "var(--orange)", moderate: "var(--amber)", low: "var(--green)" };

function istDate(d: Date): string { return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }

export default function Insights() {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { me } = useSession();
  const ref = useRefData();
  const sync = useSync();
  const hasDept = !!me?.departmentId;
  const [level, setLevel] = useLocalState<InsightLevel>(`sw.field.insights.level.${me?.id ?? "x"}`, "me");
  const [days, setDays] = useLocalState<Days>("sw.field.insights.days", 90);
  const [siteId, setSiteId] = useState("");
  const [busy, setBusy] = useState(false);
  const lv: InsightLevel = level === "department" && !hasDept ? "me" : level;
  const to = new Date();
  const from = istDate(new Date(to.getTime() - (days - 1) * 86_400_000));
  const state = useLoad(() => api.get<InsightsT>("/insights", { level: lv, from, siteIds: siteId || undefined }), [lv, from, siteId]);
  const d = state.data;
  const officerHere = siteId ? isOfficer(me, siteId) : (me?.sites ?? []).some((s) => isOfficer(me, s.id));
  const catName = (code: string) => pick(ref.categories.find((c) => c.code === code)?.name) || code;
  const deptName = pick(d?.departmentName ?? ref.departments.find((x) => x.id === me?.departmentId)?.name);

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const officerSites = (me?.sites ?? []).filter((s) => isOfficer(me, s.id)).map((s) => s.id);
      const blob = await api.download("/exports/report.xlsx", { from, siteIds: (siteId ? [siteId] : officerSites).join(",") || undefined });
      const name = `safeworks-report-${istDate(new Date())}.xlsx`;
      const file = new File([blob], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      try {
        if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ title: name, files: [file] }); return; }
      } catch (e) { if ((e as Error).name === "AbortError") return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast.success(t("charts.exported"));
    } catch (e) {
      toast.error(t("charts.exportFailed", { reason: e instanceof Error ? e.message : String(e) }));
    } finally { setBusy(false); }
  };

  const tabs: { value: InsightLevel; label: string }[] = [{ value: "me", label: t("charts.me") }];
  if (hasDept) tabs.push({ value: "department", label: t("charts.department") });
  tabs.push({ value: "site", label: t("charts.site") });

  return (
    <div className="page">
      <SyncBanner compact />
      <div className="page-head">
        <div>
          <h1>{t("nav.charts")}</h1>
          <div className="small muted">{lv === "me" ? t("charts.meSub") : lv === "department" ? t("charts.departmentSub", { name: deptName }) : t("charts.siteSub")}</div>
        </div>
        {officerHere ? <Button size="sm" onClick={exportXlsx} disabled={busy || !sync.online} data-testid="export-xlsx"><IconDownload size={18} /> {t("charts.export")}</Button> : null}
      </div>
      <Tabs value={lv} onChange={setLevel} tabs={tabs} />
      <div className="row" style={{ margin: "10px 0", flexWrap: "wrap", gap: 8 }}>
        <ChipBar>{DAYS.map((n) => <Chip key={n} on={days === n} onClick={() => setDays(n)}>{t("charts.days", { n })}</Chip>)}</ChipBar>
        {(me?.sites.length ?? 0) > 1 ? (
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={{ width: "auto" }} aria-label={t("common.site")}>
            <option value="">{t("common.site")}: {t("common.all")}</option>
            {me?.sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {pick(s.name)}</option>)}
          </Select>
        ) : null}
      </div>
      {!hasDept && level === "department" ? <p className="small muted">{t("charts.noDepartment")}</p> : null}
      {state.error && !d ? (!sync.online || (typeof navigator !== "undefined" && !navigator.onLine) || (state.error instanceof ApiError && state.error.isNetwork) ? <EmptyState icon={<IconWifiOff />} title={t("charts.offline")} body={t("charts.offlineBody")} /> : <ErrorCard error={state.error} onRetry={state.reload} />) : null}
      {!d && !state.error ? <><div className="kpis">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} block className="kpi" />)}</div><Skeleton block /></> : null}
      {state.error && d ? <p className="hint-box" role="status" data-testid="charts-stale"><IconWifiOff size={16} /> {t("charts.offline")}. {t("charts.staleBody")}</p> : null}
      {d ? (
        <>
          <div className="kpis" data-testid="insights-kpis">
            <KpiTile value={fmtNumber(d.reports.total, lang)} label={t("charts.reports")} n={t("charts.openClosed", { open: d.reports.open, closed: d.reports.closed })} />
            <KpiTile value={fmtNumber(d.reports.atRisk + d.reports.nearMiss, lang)} label={t("charts.hazards")} tone={d.reports.dangerNow ? "red" : undefined} n={d.reports.dangerNow ? t("charts.dangerNow", { n: d.reports.dangerNow }) : undefined} />
            <KpiTile value={fmtNumber(d.reports.goodPractice, lang)} label={t("type.good_practice")} tone="green" />
            <KpiTile value={fmtNumber(d.actions.open, lang)} label={t("charts.openActions")} n={t("charts.assigned", { n: d.actions.assigned })} />
            <KpiTile value={fmtNumber(d.actions.overdue, lang)} label={t("charts.overdue")} tone={d.actions.overdue ? "red" : "green"} />
            <KpiTile value={d.actions.onTimePct === null ? "—" : pct(d.actions.onTimePct, lang)} label={t("charts.onTime")} n={t("charts.verified", { n: d.actions.verified })}
              tone={d.actions.onTimePct === null ? undefined : d.actions.onTimePct >= 80 ? "green" : d.actions.onTimePct >= 50 ? "orange" : "red"} />
          </div>
          {d.reports.total === 0 && d.actions.assigned === 0 ? <EmptyState title={t("charts.empty")} body={t("charts.emptyBody")} /> : (
            <div className="dash-grid">
              <Card className="span2">
                <CardHead title={t("charts.trend")} kicker={d.bucket === "week" ? t("charts.perWeek") : t("charts.perMonth")} />
                {d.trend.length ? <TrendChart rows={d.trend} ariaLabel={t("charts.trendAria", { n: d.trend.length })} /> : <EmptyState title={t("charts.empty")} />}
              </Card>
              <Card>
                <CardHead title={t("charts.byType")} />
                <div className="bars">
                  {d.byType.map((r) => { const max = Math.max(1, ...d.byType.map((x) => x.count)); return (
                    <div className="b" key={r.key}><span className="truncate">{t(`type.${r.key}`)}</span><span className="track"><span style={{ width: `${(r.count / max) * 100}%`, background: TYPE_COLOUR[r.key] }} /></span><span className="n">{r.count}</span></div>
                  ); })}
                </div>
              </Card>
              <Card>
                <CardHead title={t("charts.byBand")} kicker={t("charts.afterTriage")} />
                <div className="bars">
                  {d.byBand.map((r) => { const max = Math.max(1, ...d.byBand.map((x) => x.count)); return (
                    <div className="b" key={r.key}><span className="truncate">{t(`band.${r.key}`)}</span><span className="track"><span style={{ width: `${(r.count / max) * 100}%`, background: BAND_COLOUR[r.key] }} /></span><span className="n">{r.count}</span></div>
                  ); })}
                </div>
              </Card>
              <Card>
                <CardHead title={t("charts.byCategory")} />
                {d.byCategory.length ? <Bars rows={d.byCategory.map((r) => ({ label: catName(r.key), n: r.count }))} /> : <EmptyState title={t("charts.empty")} />}
              </Card>
              <Card>
                <CardHead title={t("charts.reportStatus")} />
                {d.byStatus.length ? <Bars rows={d.byStatus.map((r) => ({ label: t(`obs.status.${r.key}`), n: r.count }))} colour="var(--ink-2)" /> : <EmptyState title={t("charts.empty")} />}
              </Card>
              <Card>
                <CardHead title={t("charts.actionStatus")} />
                {d.actionsByStatus.length ? <Bars rows={d.actionsByStatus.map((r) => ({ label: t(`action.status.${r.key}`), n: r.count }))} colour="var(--blue)" /> : <EmptyState title={t("charts.noActions")} />}
              </Card>
              {lv === "site" && d.byDepartment.length ? (
                <Card className="span2">
                  <CardHead title={t("charts.byDepartment")} kicker={t("charts.byDepartmentKicker")} />
                  <div className="table-wrap">
                    <table className="table" data-testid="dept-table">
                      <thead><tr><th>{t("charts.department")}</th><th className="num">{t("charts.reports")}</th><th className="num">{t("charts.assignedShort")}</th><th className="num">{t("charts.openActions")}</th><th className="num">{t("charts.overdue")}</th></tr></thead>
                      <tbody>{d.byDepartment.map((r) => (
                        <tr key={r.departmentId}><td>{pick(r.name)}</td><td className="num">{r.reports}</td><td className="num">{r.assigned}</td><td className="num">{r.open}</td><td className="num" style={r.overdue ? { color: "var(--red)", fontWeight: 700 } : undefined}>{r.overdue}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </Card>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
