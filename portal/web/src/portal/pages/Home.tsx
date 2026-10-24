import { Link } from "react-router-dom";
import { greeting } from "../../shared/format";
import { IconAlert, IconPlus, IconWalk } from "../../shared/icons";
import type { Counters, ObsListItem } from "../../shared/types";
import { Empty, ErrorNote, ObsRow, Spinner, useLoad } from "../../shared/ui";
import { api, useSession } from "../session";

interface MyDash {
  scope: "site" | "assigned";
  counters: Counters;
  raisedByMe: number;
  raisedToday: number;
  assignedToMe: Counters;
  awaitingMyApproval: number;
  dueSoon: ObsListItem[];
  openRound: { id: string; code: string; siteName: string; points: number } | null;
}

export function StatusBoard({ c, base }: { c: Counters; base: string }) {
  const sep = base.includes("?") ? "&" : "?";
  return (
    <nav className="board" aria-label="Observation counts">
      <Link to={`${base}${sep}status=any`}>
        <span className="n">{c.created}</span>
        <span className="t">Created</span>
      </Link>
      <Link to={`${base}${sep}status=open`} className="b-open">
        <span className="n">{c.open}</span>
        <span className="t">Open</span>
      </Link>
      <Link to={`${base}${sep}status=overdue`} className="b-overdue">
        <span className="n">{c.overdue}</span>
        <span className="t">Overdue</span>
      </Link>
      <Link to={`${base}${sep}status=awaiting`} className="b-awaiting">
        <span className="n">{c.awaiting}</span>
        <span className="t">Awaiting approval</span>
      </Link>
      <Link to={`${base}${sep}status=closed`} className="b-closed">
        <span className="n">{c.closed}</span>
        <span className="t">Closed</span>
      </Link>
    </nav>
  );
}

export function Home() {
  const s = useSession();
  const { data, error, loading } = useLoad<MyDash>(() => api.get("/api/dashboard/me"), []);
  const first = s.me.name.split(" ")[0];
  const raise = s.canRaiseAnywhere;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>
            {greeting()}, {first}
          </h1>
          <p>
            {s.me.designation ? `${s.me.designation} · ` : ""}
            {s.site?.name ?? s.me.company}
          </p>
        </div>
        {raise && (
          <div className="row-wrap">
            <Link to="/walks?start=1" className="btn">
              <IconWalk /> Start safety walk
            </Link>
            <Link to="/raise" className="btn btn-primary">
              <IconPlus /> Raise observation
            </Link>
          </div>
        )}
      </div>

      {loading && !data && <Spinner />}
      <ErrorNote error={error} />
      {data && (
        <>
          {data.openRound && (
            <Link to={`/walks/${data.openRound.id}`} className="alert" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <strong>Safety walk in progress</strong> · <span className="code">{data.openRound.code}</span> · {data.openRound.points} point
              {data.openRound.points === 1 ? "" : "s"} so far. Tap to continue or finish it.
            </Link>
          )}

          <section className="stack" aria-labelledby="counts-h">
            <div className="spread">
              <h2 id="counts-h">{data.scope === "site" ? "Your sites" : "Assigned to you"}</h2>
              {raise && (
                <span className="small muted">
                  You raised <strong style={{ color: "var(--ink)" }}>{data.raisedToday}</strong> today
                </span>
              )}
            </div>
            <StatusBoard c={data.counters} base={data.scope === "site" ? "/observations" : "/observations?scope=assigned"} />
          </section>

          {data.awaitingMyApproval > 0 && (
            <Link to="/approvals" className="alert" style={{ textDecoration: "none", color: "inherit", display: "flex", gap: 10, alignItems: "center" }}>
              <IconAlert />
              <span>
                <strong>{data.awaitingMyApproval}</strong> closure{data.awaitingMyApproval === 1 ? "" : "s"} waiting for your approval.
              </span>
            </Link>
          )}

          {data.scope === "site" && data.assignedToMe.open + data.assignedToMe.awaiting > 0 && (
            <Link to="/observations?scope=assigned&status=open" className="alert warn" style={{ textDecoration: "none", color: "inherit" }}>
              {data.assignedToMe.open} point{data.assignedToMe.open === 1 ? " is" : "s are"} assigned to you to close.
            </Link>
          )}

          <section className="stack" aria-labelledby="due-h">
            <div className="spread">
              <h2 id="due-h">Due next</h2>
              <Link to={data.scope === "site" ? "/observations?status=open" : "/observations?scope=assigned&status=open"} className="small">
                See all
              </Link>
            </div>
            {data.dueSoon.length ? (
              <div className="section-flush obs-list">
                {data.dueSoon.map((o) => (
                  <ObsRow key={o.id} o={o} to={`/o/${o.id}`} fileUrl={api.file} />
                ))}
              </div>
            ) : (
              <div className="section">
                <Empty title="Nothing open">
                  <p>{raise ? "Every point is closed or waiting for approval. Raise a new one when you find a hazard." : "No points are assigned to you right now."}</p>
                </Empty>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
