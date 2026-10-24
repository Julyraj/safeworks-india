import { FormEvent, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, uuid } from "../../shared/api";
import { Field, Select } from "../../shared/forms";
import { fmtDateTime, fmtTime } from "../../shared/format";
import { IconPlus, IconWalk } from "../../shared/icons";
import type { ObsListItem } from "../../shared/types";
import { Empty, ErrorNote, ObsRow, Sheet, Spinner, useLoad, useToast } from "../../shared/ui";
import { api, useSession } from "../session";

interface RoundRow {
  id: string;
  code: string;
  roundType: string;
  shift: string;
  status: "open" | "finished";
  startedAt: string;
  endedAt: string | null;
  areaNames: string[];
  site: { id: string; name: string };
  observerName: string;
  points: number;
  mine: boolean;
}

export function Walks() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const [mine, setMine] = useState(true);
  const { data, error, loading } = useLoad<{ rounds: RoundRow[] }>(() => api.get("/api/rounds", { mine: mine ? "1" : undefined, siteId: s.sites.length > 1 ? s.site?.id : undefined }), [mine, s.site?.id]);
  const starting = params.get("start") === "1";

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Safety walks</h1>
          <p>Group the points of one walk for reporting. Each point goes live as soon as you save it.</p>
        </div>
        {s.canRaiseAnywhere && (
          <button className="btn btn-primary" onClick={() => setParams({ start: "1" })}>
            <IconWalk /> Start safety walk
          </button>
        )}
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mine} onClick={() => setMine(true)}>
          My walks
        </button>
        <button role="tab" aria-selected={!mine} onClick={() => setMine(false)}>
          All walks on site
        </button>
      </div>
      {loading && !data && <Spinner />}
      <ErrorNote error={error} />
      {data &&
        (data.rounds.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Walk</th>
                  <th>Type</th>
                  <th>Started</th>
                  <th className="r">Points</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rounds.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/walks/${r.id}`} className="code">
                        {r.code}
                      </Link>
                      <div className="small muted">{r.observerName}</div>
                    </td>
                    <td>
                      {r.roundType}
                      <div className="small muted">{r.shift} shift</div>
                    </td>
                    <td>{fmtDateTime(r.startedAt)}</td>
                    <td className="r">{r.points}</td>
                    <td>{r.status === "open" ? <span className="pill s-in_progress">In progress</span> : <span className="pill s-closed">Finished</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="section">
            <Empty title="No safety walks yet">
              <p>Start a walk to group the points you raise on one round of the site.</p>
            </Empty>
          </div>
        ))}
      {starting && <StartWalk onClose={() => setParams({})} />}
    </div>
  );
}

function StartWalk({ onClose }: { onClose: () => void }) {
  const s = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const raiseSites = s.sites.filter((x) => x.can.raise);
  const [siteId, setSiteId] = useState(s.site?.can.raise ? s.site.id : raiseSites[0]?.id ?? "");
  const site = raiseSites.find((x) => x.id === siteId);
  const L = s.master.lists;
  const hour = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const [roundType, setRoundType] = useState(L.round_type?.[0]?.label ?? "Daily site walk");
  const [shift, setShift] = useState(hour >= 19 || hour < 6 ? "Night" : "Day");
  const [areas, setAreas] = useState<string[]>([]);
  const [with_, setWith] = useState("");
  const [weather, setWeather] = useState("");
  const [persons, setPersons] = useState("");
  const [busy, setBusy] = useState(false);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const id = uuid();
      await api.post("/api/rounds", { id, siteId, roundType, shift, areaNames: areas, accompaniedBy: with_, weather, personsOnSite: persons ? Number(persons) : null });
      nav(`/raise?round=${id}`);
    } catch (err) {
      toast((err as ApiError).message, true);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Start safety walk" onClose={onClose}>
      <form className="stack" onSubmit={start}>
        {raiseSites.length > 1 && (
          <Field label="Site" required>
            <Select value={siteId} onChange={setSiteId} options={raiseSites.map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
        )}
        <div className="grid-2">
          <Field label="Walk type" required>
            <Select value={roundType} onChange={setRoundType} options={(L.round_type ?? []).map((r) => ({ value: r.label, label: r.label }))} />
          </Field>
          <Field label="Shift" required>
            <Select value={shift} onChange={setShift} options={(L.shift ?? []).map((r) => ({ value: r.label, label: r.label }))} />
          </Field>
        </div>
        {site && site.areas.length > 0 && (
          <Field label="Areas covered">
            <div className="chips">
              {site.areas.map((a) => (
                <button type="button" className="chip" key={a.id} aria-pressed={areas.includes(a.name)} onClick={() => setAreas((x) => (x.includes(a.name) ? x.filter((y) => y !== a.name) : [...x, a.name]))}>
                  {a.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="Accompanied by" hint="Optional">
          <input className="input" value={with_} onChange={(e) => setWith(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Weather / heat" hint="Optional">
            <input className="input" value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="e.g. 38 °C, humid" />
          </Field>
          <Field label="Persons on site today" hint="Optional">
            <input className="input" inputMode="numeric" value={persons} onChange={(e) => setPersons(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy || !siteId}>
          {busy ? "Starting…" : "Start walk and add first point"}
        </button>
      </form>
    </Sheet>
  );
}

interface RoundDetail {
  id: string;
  code: string;
  status: "open" | "finished";
  roundType: string;
  shift: string;
  areaNames: string[];
  accompaniedBy: string;
  weather: string;
  personsOnSite: number | null;
  startedAt: string;
  endedAt: string | null;
  site: { id: string; name: string; code: string };
  observer: { name: string; designation: string; employeeId: string };
  mine: boolean;
  points: ObsListItem[];
}

export function WalkDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data: r, error, loading, reload } = useLoad<RoundDetail>(() => api.get(`/api/rounds/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  if (loading && !r) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!r) return null;
  const open = r.status === "open";

  async function finish() {
    setBusy(true);
    try {
      await api.post(`/api/rounds/${r!.id}/finish`);
      toast(`Walk finished with ${r!.points.length} point${r!.points.length === 1 ? "" : "s"}`);
      reload();
    } catch (e) {
      toast((e as ApiError).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <Link to="/walks" className="back">
        ‹ Safety walks
      </Link>
      <div className="page-head">
        <div>
          <h1 className="code">{r.code}</h1>
          <p>
            {r.roundType} · {r.shift} shift · {r.site.name}
          </p>
        </div>
        {r.mine && open && (
          <div className="row-wrap">
            <Link to={`/raise?round=${r.id}`} className="btn btn-primary">
              <IconPlus /> Add point
            </Link>
            <button className="btn" onClick={finish} disabled={busy}>
              Finish walk
            </button>
          </div>
        )}
      </div>
      <section className="section">
        <dl className="kv">
          <dt>Observer</dt>
          <dd>
            {r.observer.name}, {r.observer.designation} ({r.observer.employeeId})
          </dd>
          <dt>Time</dt>
          <dd>
            {fmtDateTime(r.startedAt)} – {r.endedAt ? fmtTime(r.endedAt) : "in progress"}
          </dd>
          {r.areaNames.length > 0 && (
            <>
              <dt>Areas covered</dt>
              <dd>{r.areaNames.join(", ")}</dd>
            </>
          )}
          {r.accompaniedBy && (
            <>
              <dt>Accompanied by</dt>
              <dd>{r.accompaniedBy}</dd>
            </>
          )}
          {r.weather && (
            <>
              <dt>Weather / heat</dt>
              <dd>{r.weather}</dd>
            </>
          )}
          {r.personsOnSite !== null && (
            <>
              <dt>Persons on site</dt>
              <dd>{r.personsOnSite}</dd>
            </>
          )}
        </dl>
      </section>
      <section className="stack">
        <h2>
          {r.points.length} point{r.points.length === 1 ? "" : "s"}
        </h2>
        {r.points.length ? (
          <div className="section-flush obs-list">
            {r.points.map((o) => (
              <ObsRow key={o.id} o={o} to={`/o/${o.id}`} fileUrl={api.file} />
            ))}
          </div>
        ) : (
          <div className="section">
            <Empty title="No points yet">
              <p>Add the first point of this walk.</p>
            </Empty>
          </div>
        )}
      </section>
    </div>
  );
}
