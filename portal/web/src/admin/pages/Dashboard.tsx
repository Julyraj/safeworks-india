/* Dashboard: KPI tiles (with n), breakdowns, weekly SVG chart, ageing, days-to-close, repeat findings. Site + date filters, CSV of the view. */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import type { Band, Dashboard as DashboardT, Kpi, ObservationType } from "../../shared/types";
import { Bars, Card, CardHead, EmptyState, ErrorCard, Field, Input, KpiTile, Skeleton, BandPill } from "../../shared/ui";
import { useLoad, useLocalState } from "../../shared/hooks";
import { fmtNumber, pct } from "../../shared/format";
import { api, localCsv } from "../api";
import { useScope } from "../scope";
import { PageHead, ExportButton } from "../components";

const TYPE_COLOUR: Record<ObservationType, string> = { good_practice: "var(--green)", unsafe_act: "var(--amber)", unsafe_condition: "var(--orange)", near_miss: "var(--red)" };

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 89 * 86_400_000);
  const f = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return { from: f(from), to: f(to) };
}

export default function Dashboard() {
  const { t, lang, pick } = useI18n();
  const { siteId, siteName, sites } = useScope();
  const [range, setRange] = useLocalState("sw.admin.dash.range", defaultRange());
  const state = useLoad(() => api.get<DashboardT>("/dashboard", { siteIds: siteId || undefined, from: range.from, to: range.to }), [siteId, range.from, range.to]);
  const d = state.data;

  const kpiTone = (k: Kpi): "red" | "green" | "orange" | undefined => {
    if (k.value === null) return undefined;
    if (/overdue|backlog|discard/i.test(k.key)) return k.value > 0 ? "red" : "green";
    if (/on_time|ontime|completion|participation/i.test(k.key)) return k.value >= 80 ? "green" : k.value >= 50 ? "orange" : "red";
    return undefined;
  };
  const kpiValue = (k: Kpi) => (k.value === null ? "—" : k.unit === "%" ? pct(k.value, lang) : k.unit ? `${fmtNumber(k.value, lang, 1)} ${k.unit}` : fmtNumber(k.value, lang, 1));

  const exportView = async () => {
    if (!d) return;
    const rows: Record<string, unknown>[] = [];
    d.kpis.forEach((k) => rows.push({ section: "kpi", key: k.key, label: pick(k.label), value: k.value, n: k.n ?? "", unit: k.unit ?? "" }));
    d.byType.forEach((r) => rows.push({ section: "byType", key: r.type, label: t(`type.${r.type}`), value: r.count, n: "", unit: "" }));
    d.byCategory.forEach((r) => rows.push({ section: "byCategory", key: r.code, label: r.code, value: r.count, n: `safe ${r.safe} / at-risk ${r.atRisk}`, unit: "" }));
    d.byArea.forEach((r) => rows.push({ section: "byArea", key: r.areaId, label: pick(r.name), value: r.count, n: "", unit: "" }));
    d.byEmployer.forEach((r) => rows.push({ section: "byEmployer", key: r.employerId ?? "", label: r.name, value: r.count, n: "", unit: "" }));
    d.weekly.forEach((r) => rows.push({ section: "weekly", key: r.week, label: r.week, value: r.reports, n: `at-risk ${r.atRisk} / good ${r.good}`, unit: "" }));
    d.ageing.forEach((r) => rows.push({ section: "ageing", key: r.bucket, label: r.bucket, value: r.count, n: "", unit: "" }));
    d.daysToCloseByBand.forEach((r) => rows.push({ section: "daysToClose", key: r.band, label: t(`band.${r.band}`), value: r.median ?? "", n: r.n, unit: "days" }));
    localCsv(rows, `dashboard-${siteId ? sites.find((s) => s.id === siteId)?.code ?? "site" : "all"}-${range.from}-${range.to}.csv`);
  };

  return (
    <>
      <PageHead title={t("dash.title")} sub={siteId ? siteName(siteId) : t("top.allSites")} tools={
        <>
          <Field label={t("reg.from")}><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} style={{ minHeight: 38, padding: "4px 8px" }} /></Field>
          <Field label={t("reg.to")}><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} style={{ minHeight: 38, padding: "4px 8px" }} /></Field>
          <ExportButton onExport={exportView} label={t("dash.exportView")} />
        </>
      } />
      {state.error && !d ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      {!d && !state.error ? (
        <>
          <div className="kpis">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} block className="kpi" />)}</div>
          <div className="dash-grid"><Skeleton block /><Skeleton block /><Skeleton block /></div>
        </>
      ) : null}
      {d ? (
        <>
          <div className="kpis">
            {d.kpis.map((k) => (
              <KpiTile key={k.key} value={kpiValue(k)} label={pick(k.label)} tone={kpiTone(k)} n={k.n !== undefined ? t("dash.n", { n: k.n }) : undefined}
                hint={[pick(k.hint), k.formula ? `${t("dash.formula")}: ${k.formula}` : ""].filter(Boolean).join("\n")} />
            ))}
          </div>
          {d.sampleNote?.en ? <p className="small muted">{pick(d.sampleNote)}</p> : null}
          <div className="dash-grid">
            <Card className="span2">
              <CardHead title={t("dash.weekly")} kicker={t("dash.weeklyKicker")} />
              {d.weekly.length ? <WeeklyChart rows={d.weekly} /> : <EmptyState title={t("dash.noData")} body={t("dash.noDataHint")} />}
            </Card>
            <Card>
              <CardHead title={t("dash.byType")} />
              {d.byType.length ? (
                <div className="bars">
                  {d.byType.map((r) => { const max = Math.max(1, ...d.byType.map((x) => x.count)); return (
                    <div className="b" key={r.type}><span className="truncate">{t(`type.${r.type}`)}</span><span className="track"><span style={{ width: `${(r.count / max) * 100}%`, background: TYPE_COLOUR[r.type] }} /></span><span className="n">{r.count}</span></div>
                  ); })}
                </div>
              ) : <EmptyState title={t("dash.noData")} />}
            </Card>
            <Card>
              <CardHead title={t("dash.byCategory")} kicker={t("dash.safeVsAtRisk")} />
              {d.byCategory.length ? (
                <div>
                  {d.byCategory.slice(0, 12).map((r) => { const tot = Math.max(1, r.safe + r.atRisk); return (
                    <div className="cat-row" key={r.code}>
                      <Link to={`/observations?category=${r.code}`} className="truncate">{r.code}</Link>
                      <div className="split-bar" title={`${t("dash.safe")} ${r.safe} · ${t("dash.atRisk")} ${r.atRisk}`}><span style={{ width: `${(r.safe / tot) * 100}%`, background: "var(--green)" }} /><span style={{ width: `${(r.atRisk / tot) * 100}%`, background: "var(--orange)" }} /></div>
                      <span className="n">{r.count}</span>
                    </div>
                  ); })}
                  <div className="legend"><span><span className="sw" style={{ background: "var(--green)" }} />{t("dash.safe")}</span><span><span className="sw" style={{ background: "var(--orange)" }} />{t("dash.atRisk")}</span></div>
                </div>
              ) : <EmptyState title={t("dash.noData")} />}
            </Card>
            <Card>
              <CardHead title={t("dash.byArea")} />
              {d.byArea.length ? <Bars rows={d.byArea.slice(0, 10).map((r) => ({ label: pick(r.name), n: r.count }))} /> : <EmptyState title={t("dash.noData")} />}
            </Card>
            <Card>
              <CardHead title={t("dash.byEmployer")} />
              {d.byEmployer.length ? <Bars rows={d.byEmployer.slice(0, 10).map((r) => ({ label: r.name || t("common.ownCompany"), n: r.count }))} colour="var(--ink-2)" /> : <EmptyState title={t("dash.noData")} />}
            </Card>
            <Card>
              <CardHead title={t("dash.ageing")} kicker={t("dash.ageingKicker")} />
              {d.ageing.length ? <Bars rows={d.ageing.map((r) => ({ label: t("dash.ageBucket", { b: r.bucket }), n: r.count }))} colour="var(--orange)" /> : <EmptyState title={t("dash.noData")} />}
            </Card>
            <Card>
              <CardHead title={t("dash.daysToClose")} kicker={t("dash.median")} />
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t("common.risk")}</th><th className="num">{t("dash.medianDays")}</th><th className="num">n</th></tr></thead>
                  <tbody>
                    {(["extreme", "high", "moderate", "low"] as Band[]).map((b) => { const r = d.daysToCloseByBand.find((x) => x.band === b); return (
                      <tr key={b}><td><BandPill band={b} /></td><td className="num">{r?.median === null || r?.median === undefined ? "—" : fmtNumber(r.median, lang, 1)}</td><td className="num">{r?.n ?? 0}</td></tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card className="span2">
              <CardHead title={t("dash.repeat")} kicker={t("dash.repeatKicker")} action={<Link to="/inspections" className="small">{t("nav.inspections")} →</Link>} />
              {d.topRepeatFindings.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{t("dash.question")}</th><th>{t("templates.template")}</th><th className="num">{t("dash.times")}</th></tr></thead>
                    <tbody>{d.topRepeatFindings.map((r, i) => <tr key={i}><td>{pick(r.questionText)}</td><td>{pick(r.templateName)}</td><td className="num">{r.count}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : <EmptyState title={t("dash.noRepeat")} body={t("dash.noRepeatHint")} />}
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}

/** Weekly reports chart in plain SVG: stacked bars (good / at-risk) with a total line. */
export function WeeklyChart({ rows }: { rows: DashboardT["weekly"] }) {
  const { t } = useI18n();
  const W = 720, H = 220, padL = 36, padR = 10, padT = 12, padB = 30;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.reports, r.atRisk + r.good)));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = Math.max(4, Math.min(28, (innerW / rows.length) * 0.6));
  const x = (i: number) => padL + (innerW / rows.length) * (i + 0.5);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = useMemo(() => { const n = 4; return Array.from({ length: n + 1 }, (_, i) => Math.round((max / n) * i)); }, [max]);
  const line = rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(r.reports).toFixed(1)}`).join(" ");
  const every = Math.ceil(rows.length / 12);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("dash.weeklyAria", { n: rows.length })}>
        {ticks.map((v) => <g key={v}><line className="grid" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} /><text x={padL - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        <line className="axis" x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} />
        {rows.map((r, i) => (
          <g key={r.week}>
            <rect x={x(i) - bw / 2} y={y(r.good)} width={bw} height={innerH + padT - y(r.good)} fill="var(--green)" opacity={0.9}><title>{`${r.week}: ${t("dash.good")} ${r.good}`}</title></rect>
            <rect x={x(i) - bw / 2} y={y(r.good + r.atRisk)} width={bw} height={y(r.good) - y(r.good + r.atRisk)} fill="var(--orange)" opacity={0.9}><title>{`${r.week}: ${t("dash.atRisk")} ${r.atRisk}`}</title></rect>
            {i % every === 0 ? <text x={x(i)} y={H - 10} textAnchor="middle">{r.week.slice(-5)}</text> : null}
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth={2} />
        {rows.map((r, i) => <circle key={r.week} cx={x(i)} cy={y(r.reports)} r={3} fill="var(--ink)"><title>{`${r.week}: ${r.reports}`}</title></circle>)}
      </svg>
      <div className="legend">
        <span><span className="sw" style={{ background: "var(--green)" }} />{t("dash.good")}</span>
        <span><span className="sw" style={{ background: "var(--orange)" }} />{t("dash.atRisk")}</span>
        <span><span className="sw" style={{ background: "var(--ink)" }} />{t("dash.total")}</span>
      </div>
    </div>
  );
}
