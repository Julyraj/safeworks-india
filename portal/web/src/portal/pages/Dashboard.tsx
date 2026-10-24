import { useState } from "react";
import { Link } from "react-router-dom";
import { daysAgo, fmtDate, todayLocal } from "../../shared/format";
import type { SiteDashboard as Dash } from "../../shared/types";
import { Bars, Empty, ErrorNote, pct, Risk, Spinner, useLoad, WeeklyChart } from "../../shared/ui";
import { StatusBoard } from "./Home";
import { api, useSession } from "../session";

const PERIODS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

export function SiteDashboard() {
  const s = useSession();
  const site = s.site && s.site.can.viewAll ? s.site : s.sites.find((x) => x.can.viewAll);
  const [days, setDays] = useState(90);
  const { data: d, error, loading } = useLoad<Dash>(
    () => (site ? api.get(`/api/dashboard/site/${site.id}`, { from: daysAgo(days - 1), to: todayLocal() }) : Promise.reject(new Error("No site dashboard for your login."))),
    [site?.id, days],
  );
  if (!site) {
    return (
      <div className="section">
        <Empty title="Site dashboard is for safety officers and managers">
          <p>Your points are on the home page.</p>
        </Empty>
      </div>
    );
  }
  const officers = d ? [...new Set(d.perOfficer.map((r) => r.officer))] : [];
  const lastDays = Array.from({ length: 14 }, (_, i) => daysAgo(13 - i));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Site dashboard</h1>
          <p>{site.name}</p>
        </div>
        <div className="tabs" role="tablist" style={{ marginBottom: 0, borderBottom: 0 }}>
          {PERIODS.map((p) => (
            <button key={p.days} role="tab" aria-selected={days === p.days} onClick={() => setDays(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {loading && !d && <Spinner />}
      <ErrorNote error={error} />
      {d && (
        <>
          <StatusBoard c={d.counters} base="/observations" />
          <div className="kpis">
            <div>
              <div className="v">{d.kpis.raised}</div>
              <div className="k">Raised in period</div>
            </div>
            <div>
              <div className="v">{pct(d.kpis.closureRate)}</div>
              <div className="k">Closure rate</div>
            </div>
            <div>
              <div className="v">{pct(d.kpis.onTimeClosure)}</div>
              <div className="k">Closed on time</div>
            </div>
            <div>
              <div className="v">{d.kpis.avgDaysToClose ?? "—"}</div>
              <div className="k">Average days to close</div>
            </div>
            <div>
              <div className="v">{d.kpis.actConditionRatio ?? "—"}</div>
              <div className="k">Unsafe acts per unsafe condition</div>
            </div>
            <div>
              <div className="v">{pct(d.kpis.safeBehaviourShare)}</div>
              <div className="k">Safe-behaviour share</div>
            </div>
            <div>
              <div className="v">{pct(d.kpis.repeatRate)}</div>
              <div className="k">Repeat rate</div>
            </div>
            <div>
              <div className="v">{d.kpis.highCritical}</div>
              <div className="k">High and critical raised</div>
            </div>
          </div>

          <section className="section">
            <h3>Raised and closed per week</h3>
            <WeeklyChart weeks={d.weekly} />
          </section>

          <section className="section">
            <h3>Overdue, with owners</h3>
            {d.overdue.length ? (
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Point</th>
                      <th>Risk</th>
                      <th>Owner</th>
                      <th className="r">Days overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.overdue.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link to={`/o/${o.id}`} className="code">
                            {o.code}
                          </Link>
                          <div className="small">{o.item}</div>
                        </td>
                        <td>
                          <Risk level={o.riskLevel} />
                        </td>
                        <td>{o.ownerName ?? "Not assigned"}</td>
                        <td className="r due-late">{Math.max(o.daysOverdue, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Nothing overdue. Well done.</p>
            )}
          </section>

          <div className="grid-2">
            <section className="section">
              <h3>By category</h3>
              <Bars rows={d.byCategory} />
            </section>
            <section className="section">
              <h3>By hazard</h3>
              <Bars rows={d.byHazard} />
            </section>
            <section className="section">
              <h3>By area</h3>
              <Bars rows={d.byArea} />
            </section>
            <section className="section">
              <h3>By contractor</h3>
              <Bars rows={d.byContractor} />
            </section>
            <section className="section">
              <h3>By risk level</h3>
              <Bars rows={["Critical", "High", "Medium", "Low"].map((l) => ({ label: l, n: d.byRisk.find((r) => r.label === l)?.n ?? 0 }))} />
            </section>
            <section className="section">
              <h3>Life-Saving Rule breaches</h3>
              <Bars rows={d.lsrBreaches} color="var(--red)" />
            </section>
          </div>

          <section className="section">
            <h3>Repeat observations</h3>
            {d.repeats.length ? (
              <Bars rows={d.repeats.map((r) => ({ label: `${r.label}${r.area ? ` (${r.area})` : ""}`, n: r.n }))} color="var(--orange)" />
            ) : (
              <p className="muted small">No repeats in this period.</p>
            )}
          </section>

          <section className="section">
            <h3>Points per safety officer, last 14 days</h3>
            {officers.length ? (
              <div className="table-wrap" style={{ border: 0 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Safety officer</th>
                      {lastDays.map((dd) => (
                        <th key={dd} className="r">
                          {new Date(dd + "T00:00:00").getDate()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {officers.map((o) => (
                      <tr key={o}>
                        <td style={{ whiteSpace: "nowrap" }}>{o}</td>
                        {lastDays.map((dd) => {
                          const n = d.perOfficer.find((r) => r.officer === o && r.day === dd)?.n ?? 0;
                          return (
                            <td key={dd} className="r" style={{ color: n ? undefined : "var(--line-strong)" }}>
                              {n}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No points raised in the last 14 days.</p>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>
              Period {fmtDate(d.period.from)} – {fmtDate(d.period.to)}.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
