import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, isNative, serverBase } from "../../shared/api";
import { fmtDateTime } from "../../shared/format";
import { IconBook, IconChart, IconLock, IconLogout, IconPhone, IconWalk } from "../../shared/icons";
import { ObservationView } from "../../shared/ObservationView";
import { Empty, ErrorNote, Spinner, useLoad, useToast } from "../../shared/ui";
import { flush, list, QueuedPoint, remove } from "../outbox";
import { api, useSession } from "../session";
import { ChangePassword } from "./Login";

export function ObservationPage() {
  const { id = "" } = useParams();
  const s = useSession();
  const nav = useNavigate();
  return (
    <div className="stack">
      <button className="back btn-ghost" style={{ border: 0, background: "none", cursor: "pointer", padding: 0, alignSelf: "flex-start" }} onClick={() => (history.length > 1 ? nav(-1) : nav("/observations"))}>
        ‹ Back
      </button>
      <ObservationView api={api} id={id} me={{ id: s.me.id, name: s.me.name }} linkPrefix="/o/" />
    </div>
  );
}

interface Note {
  id: number;
  kind: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  observationId: string | null;
}

export function Notifications() {
  const { data, error, loading, reload } = useLoad<{ items: Note[] }>(() => api.get("/api/notifications"), []);
  const unread = data?.items.filter((n) => !n.read).length ?? 0;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Assignments, closures, approvals, due dates and escalations.</p>
        </div>
        {unread > 0 && (
          <button className="btn" onClick={() => api.post("/api/notifications/read").then(reload)}>
            Mark all as read
          </button>
        )}
      </div>
      {loading && !data && <Spinner />}
      <ErrorNote error={error} />
      {data &&
        (data.items.length ? (
          <div className="section-flush">
            {data.items.map((n) => {
              const inner = (
                <>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    {!n.read && <span aria-label="Unread" style={{ width: 10, height: 10, borderRadius: 5, background: "var(--hivis)", marginTop: 7, flex: "none" }} />}
                    <div className="grow">
                      <div style={{ fontWeight: n.read ? 500 : 700 }}>{n.title}</div>
                      {n.body && <div className="small muted">{n.body}</div>}
                      <div className="small muted">{fmtDateTime(n.at)}</div>
                    </div>
                  </div>
                </>
              );
              const style = { display: "block", padding: "12px 16px", borderBottom: "1px solid var(--line)", textDecoration: "none", color: "inherit" };
              return n.observationId ? (
                <Link key={n.id} to={`/o/${n.observationId}`} style={style} onClick={() => !n.read && api.post("/api/notifications/read", { ids: [n.id] })}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id} style={style}>
                  {inner}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="section">
            <Empty title="No notifications">
              <p>You'll be told here when a point is assigned to you, submitted, approved or overdue.</p>
            </Empty>
          </div>
        ))}
    </div>
  );
}

export function More() {
  const s = useSession();
  const [pw, setPw] = useState(false);
  const toast = useToast();
  const viewAll = s.sites.some((x) => x.can.viewAll);
  if (pw)
    return (
      <div className="section" style={{ maxWidth: 520 }}>
        <ChangePassword
          me={s.me}
          onDone={() => {
            setPw(false);
            toast("Password changed");
          }}
          onCancel={() => setPw(false)}
        />
      </div>
    );
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{s.me.name}</h1>
          <p>
            {s.me.designation} · {s.me.employeeId} · {s.me.company}
          </p>
        </div>
      </div>
      <section className="section">
        <h3>Your roles</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {s.me.roles.map((r, i) => (
            <li key={i}>
              {r.roleLabel} – {r.siteName}
            </li>
          ))}
        </ul>
      </section>
      <nav className="section-flush" aria-label="More">
        {[
          s.canRaiseAnywhere && { to: "/walks", icon: <IconWalk />, label: "Safety walks" },
          viewAll && { to: "/dashboard", icon: <IconChart />, label: "Site dashboard" },
          { to: "/sos", icon: <IconPhone />, label: "SOS – emergency numbers" },
          { href: "/library/", icon: <IconBook />, label: "Safety library: procedures, first aid, regulations" },
        ]
          .filter(Boolean)
          .map((x: any) =>
            x.href ? (
              <a key={x.label} href={(isNative ? serverBase() : "") + x.href} className="row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", textDecoration: "none", color: "inherit", gap: 12 }}>
                {x.icon} {x.label}
              </a>
            ) : (
              <Link key={x.label} to={x.to} className="row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", textDecoration: "none", color: "inherit", gap: 12 }}>
                {x.icon} {x.label}
              </Link>
            ),
          )}
        <button className="row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", width: "100%", background: "none", border: 0, borderBottomStyle: "solid", cursor: "pointer", gap: 12, textAlign: "left" }} onClick={() => setPw(true)}>
          <IconLock /> Change password
        </button>
        <button className="row" style={{ padding: "14px 16px", width: "100%", background: "none", border: 0, cursor: "pointer", gap: 12, color: "var(--red)", textAlign: "left" }} onClick={() => s.signOut()}>
          <IconLogout /> Sign out
        </button>
      </nav>
      <p className="small muted">
        SafeWorks portal 1.0{isNative ? ` · server ${serverBase()}` : ""}. Forgot your password? Your admin can reset it.
      </p>
    </div>
  );
}

const NATIONAL: [string, string][] = [
  ["Unified emergency (police, fire, ambulance)", "112"],
  ["Fire", "101"],
  ["Ambulance", "108"],
  ["Police", "100"],
  ["State disaster helpline", "1070"],
  ["District disaster control room", "1077"],
  ["National Poisons Information Centre (AIIMS)", "1800116117"],
  ["Women helpline", "181"],
];
const STATE: Record<string, [string, string][]> = {
  Karnataka: [
    ["BESCOM power emergency (Bengaluru)", "1912"],
    ["BWSSB water (Bengaluru)", "1916"],
  ],
  "Tamil Nadu": [
    ["TANGEDCO power", "1912"],
    ["CMWSSB water (Chennai)", "04445674567"],
  ],
};

function telFmt(n: string) {
  return n.length === 10 && n.startsWith("1800") ? `${n.slice(0, 4)}-${n.slice(4, 7)}-${n.slice(7)}` : n;
}

export function Sos() {
  const s = useSession();
  const site = s.site;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>SOS</h1>
          <p>Tap a number to call. In any emergency, call 112 first.</p>
        </div>
      </div>
      <a href="tel:112" className="btn btn-block" style={{ minHeight: 88, fontSize: "1.6rem", fontFamily: "var(--font-cond)", fontWeight: 700, background: "var(--red)", borderColor: "var(--red)", color: "#fff" }}>
        <IconPhone size={30} /> Call 112
      </a>
      {site && (site.siteHead.phone || site.safetyOfficers.some((x) => x.phone)) && (
        <section className="section">
          <h3>{site.name}</h3>
          <div className="stack" style={{ gap: 0 }}>
            {site.siteHead.phone && <CallRow label={`Site head – ${site.siteHead.name || "site head"}`} n={site.siteHead.phone} />}
            {site.safetyOfficers
              .filter((x) => x.phone)
              .map((x) => (
                <CallRow key={x.phone} label={`Safety officer – ${x.name}`} n={x.phone} />
              ))}
          </div>
        </section>
      )}
      <section className="section">
        <h3>National</h3>
        <div className="stack" style={{ gap: 0 }}>
          {NATIONAL.map(([l, n]) => (
            <CallRow key={l} label={l} n={n} />
          ))}
        </div>
      </section>
      {site && STATE[site.state] && (
        <section className="section">
          <h3>{site.state}</h3>
          <div className="stack" style={{ gap: 0 }}>
            {STATE[site.state].map(([l, n]) => (
              <CallRow key={l} label={l} n={n} />
            ))}
          </div>
        </section>
      )}
      <p className="small muted">
        More contacts, first aid and the emergency procedures are in the <a href={(isNative ? serverBase() : "") + "/library/#emergency"}>safety library</a>.
      </p>
    </div>
  );
}

function CallRow({ label, n }: { label: string; n: string }) {
  return (
    <a href={`tel:${n.replace(/[^0-9+]/g, "")}`} className="spread" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)", textDecoration: "none", color: "inherit", minHeight: 52 }}>
      <span>{label}</span>
      <strong className="code" style={{ fontSize: "1.25rem", color: "var(--ink)" }}>
        {telFmt(n)}
      </strong>
    </a>
  );
}

export function Outbox() {
  const [items, setItems] = useState<QueuedPoint[] | null>(null);
  const toast = useToast();
  const load = () => list().then(setItems);
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Saved on this phone</h1>
          <p>Points waiting to upload. They upload automatically when you are online.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={async () => {
            const n = await flush(api);
            toast(n ? `${n} uploaded` : navigator.onLine ? "Nothing uploaded – see the messages below" : "Still offline");
            load();
          }}
        >
          Upload now
        </button>
      </div>
      {!items ? (
        <Spinner />
      ) : items.length ? (
        <div className="section-flush">
          {items.map((p) => (
            <div key={p.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }} className="stack">
              <div className="spread">
                <strong>{p.label}</strong>
                <span className="small muted">{fmtDateTime(new Date(p.createdAt).toISOString())}</span>
              </div>
              <div className="small muted">
                {p.photos.length} photo{p.photos.length === 1 ? "" : "s"} · {p.attempts} upload attempt{p.attempts === 1 ? "" : "s"}
              </div>
              {p.lastError && <div className={`small ${p.failed ? "due-late" : "muted"}`}>{p.failed ? `Not accepted by the server: ${p.lastError}` : p.lastError}</div>}
              {p.failed && (
                <button
                  className="btn btn-sm btn-danger"
                  style={{ alignSelf: "flex-start" }}
                  onClick={async () => {
                    if (confirm("Discard this saved point? It was not accepted by the server.")) {
                      await remove(p.id);
                      load();
                    }
                  }}
                >
                  Discard
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="section">
          <Empty title="Nothing waiting">
            <p>Every point you raised has reached the server.</p>
          </Empty>
        </div>
      )}
      <ErrorNote error={null as ApiError | null} />
    </div>
  );
}
