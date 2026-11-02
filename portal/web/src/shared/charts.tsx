/* Small plain-SVG charts shared by the field app and the admin console (no chart library).
   Trend: stacked columns per period (good practice below, at-risk above) on one count axis, a legend, and a hover title on
   every mark. Colours come from the design tokens: green = good practice, orange = at-risk (as on the admin dashboard). */
import { useMemo } from "react";
import { useI18n } from "./i18n";

export interface TrendRow { period: string; good: number; atRisk: number; reports: number }

export function TrendChart({ rows, ariaLabel }: { rows: TrendRow[]; ariaLabel: string }) {
  const { t } = useI18n();
  const W = 640, H = 200, padL = 32, padR = 8, padT = 10, padB = 28;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.reports, r.good + r.atRisk)));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const bw = Math.max(6, Math.min(36, (innerW / Math.max(1, rows.length)) * 0.6));
  const x = (i: number) => padL + (innerW / Math.max(1, rows.length)) * (i + 0.5);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const ticks = useMemo(() => { const n = Math.min(4, max); return Array.from({ length: n + 1 }, (_, i) => Math.round((max / n) * i)); }, [max]);
  const every = Math.ceil(rows.length / 8);
  const label = (p: string) => (p.includes("-W") ? p.slice(-3) : p.slice(2)); // 2026-W41 → W41, 2026-10 → 26-10
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        {ticks.map((v) => <g key={v}><line className="grid" x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} /><text x={padL - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        <line className="axis" x1={padL} x2={W - padR} y1={padT + innerH} y2={padT + innerH} />
        {rows.map((r, i) => {
          const gap = r.good && r.atRisk ? 2 : 0; // 2px surface gap between stacked segments
          return (
            <g key={r.period}>
              {r.good ? <rect x={x(i) - bw / 2} y={y(r.good)} width={bw} height={Math.max(1, padT + innerH - y(r.good))} fill="var(--green)"><title>{`${r.period} · ${t("charts.good")}: ${r.good}`}</title></rect> : null}
              {r.atRisk ? <rect x={x(i) - bw / 2} y={y(r.good + r.atRisk)} width={bw} height={Math.max(1, y(r.good) - y(r.good + r.atRisk) - gap)} fill="var(--orange)" rx={2}><title>{`${r.period} · ${t("charts.atRisk")}: ${r.atRisk}`}</title></rect> : null}
              <rect x={x(i) - bw / 2 - 4} y={padT} width={bw + 8} height={innerH} fill="transparent"><title>{`${r.period}: ${t("charts.total")} ${r.reports} · ${t("charts.good")} ${r.good} · ${t("charts.atRisk")} ${r.atRisk}`}</title></rect>
              {i % every === 0 ? <text x={x(i)} y={H - 9} textAnchor="middle">{label(r.period)}</text> : null}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><span className="sw" style={{ background: "var(--green)" }} />{t("charts.good")}</span>
        <span><span className="sw" style={{ background: "var(--orange)" }} />{t("charts.atRisk")}</span>
      </div>
    </div>
  );
}
