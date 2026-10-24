import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fmtDate } from "../../shared/format";
import { Bars, ErrorNote, pct, Risk, Spinner, useLoad, WeeklyChart } from "../../shared/ui";
import { api } from "../ctx";
import type { Overview as OverviewData } from "../types";
import { PageHead, PeriodSelect, periodRange } from "./common";

export default function Overview() {
  const [days, setDays] = useState(30);
  const range = periodRange(days);
  const { data, error, loading } = useLoad<OverviewData>(() => api.get("/api/admin/overview", range), [days]);
  const nav = useNavigate();

  const d = data?.dashboard;
  return (
    <div className="stack-lg">
      <PageHead
        title="Company overview"
        sub={data ? `All active sites · ${fmtDate(range.from)} to ${fmtDate(range.to)} for raised and closed figures; open and overdue are as of now.` : undefined}
        actions={<PeriodSelect days={days} onChange={setDays} />}
      />
      <ErrorNote error={error} />
      {loading && !data && <Spinner />}
      {d && data && (
        <>
          <nav className="board" aria-label="Observation status across the company">
            <Link to="/observations?status=any" className="b-created">
              <span className="n">{d.counters.created}</span>
              <span className="t">Created</span>
            </Link>
            <Link to="/observations?status=open" className="b-open">
              <span className="n">{d.counters.open}</span>
              <span className="t">Open</span>
            </Link>
            <Link to="/observations?status=overdue" className="b-overdue">
              <span className="n">{d.counters.overdue}</span>
              <span className="t">Overdue</span>
            </Link>
            <Link to="/observations?status=awaiting" className="b-awaiting">
              <span className="n">{d.counters.awaiting}</span>
              <span className="t">Awaiting approval</span>
            </Link>
            <Link to="/observations?status=closed" className="b-closed">
              <span className="n">{d.counters.closed}</span>
              <span className="t">Closed</span>
            </Link>
          </nav>

          <section aria-label="Key indicators for the period">
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
                <div className="v">{d.kpis.highCritical}</div>
                <div className="k">High or critical raised</div>
              </div>
              <div>
                <div className="v">{d.kpis.actConditionRatio ?? "—"}</div>
                <div className="k">Unsafe act : condition</div>
              </div>
              <div>
                <div className="v">{d.kpis.nearMisses}</div>
                <div className="k">Near misses</div>
              </div>
              <div>
                <div className="v">{pct(d.kpis.repeatRate)}</div>
                <div className="k">Repeat observations</div>
              </div>
            </div>
          </section>

          <section className="section-flush">
            <div style={{ padding: "14px 16px 4px" }}>
              <h3>Sites</h3>
              <p className="small muted">Select a site to see its observations.</p>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="r">Open</th>
                    <th className="r">Overdue</th>
                    <th className="r">Awaiting approval</th>
                    <th className="r">High / critical open</th>
                    <th className="r">Raised</th>
                    <th className="r">Closed</th>
                    <th className="r">Closure rate</th>
                    <th className="r">Avg days to close</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sites.map((s) => (
                    <tr
                      key={s.id}
                      className={`click ${s.active ? "" : "inactive"}`}
                      tabIndex={0}
                      onClick={() => nav(`/observations?siteId=${s.id}`)}
                      onKeyDown={(e) => e.key === "Enter" && nav(`/observations?siteId=${s.id}`)}
                    >
                      <td>
                        <strong>{s.name}</strong>
                        <div className="small muted">
                          <span className="code">{s.code}</span> · {s.state}
                          {!s.active && " · inactive"}
                        </div>
                      </td>
                      <td className="r">{s.open}</td>
                      <td className="r" style={s.overdue ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                        {s.overdue}
                      </td>
                      <td className="r">{s.awaiting}</td>
                      <td className="r">{s.highCriticalOpen}</td>
                      <td className="r">{s.raised}</td>
                      <td className="r">{s.closed}</td>
                      <td className="r">{pct(s.closureRate)}</td>
                      <td className="r">{s.avgDaysToClose ?? "—"}</td>
                    </tr>
                  ))}
                  {data.sites.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted">
                        No sites yet. Add your first site under Sites & areas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="section">
            <h3>Raised and closed per week</h3>
            <WeeklyChart weeks={d.weekly} />
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
              <h3>By risk level</h3>
              <Bars rows={d.byRisk} />
            </section>
            <section className="section">
              <h3>By contractor</h3>
              <Bars rows={d.byContractor} />
            </section>
            {d.lsrBreaches.length > 0 && (
              <section className="section">
                <h3>Life-Saving Rule breaches</h3>
                <Bars rows={d.lsrBreaches} color="var(--red)" />
              </section>
            )}
            {d.repeats.length > 0 && (
              <section className="section">
                <h3>Repeat observations</h3>
                <Bars rows={d.repeats.map((r) => ({ label: r.area ? `${r.label} (${r.area})` : r.label, n: r.n }))} />
              </section>
            )}
          </div>

          <section className="section-flush">
            <div style={{ padding: "14px 16px 4px" }}>
              <h3>Overdue now</h3>
            </div>
            {d.overdue.length === 0 ? (
              <p className="muted" style={{ padding: "0 16px 16px" }}>
                Nothing is overdue.
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Observation</th>
                      <th>Site</th>
                      <th>Owner</th>
                      <th>Risk</th>
                      <th>Due</th>
                      <th className="r">Days overdue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.overdue.map((o) => (
                      <tr key={o.id} className="click" tabIndex={0} onClick={() => nav(`/observations/${o.id}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/observations/${o.id}`)}>
                        <td>
                          <span className="code">{o.code}</span>
                          <div className="small">{o.item}</div>
                        </td>
                        <td>{o.siteName}</td>
                        <td>{o.ownerName ?? <span className="muted">Not assigned</span>}</td>
                        <td>
                          <Risk level={o.riskLevel} />
                        </td>
                        <td>{fmtDate(o.dueAt)}</td>
                        <td className="r" style={{ color: "var(--red)", fontWeight: 700 }}>
                          {o.daysOverdue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
