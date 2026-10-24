import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { IconSearch } from "../../shared/icons";
import type { ObsListItem } from "../../shared/types";
import { Empty, ErrorNote, ObsRow, Spinner } from "../../shared/ui";
import { api, useSession } from "../session";

interface Page {
  items: ObsListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function ObservationList({
  query,
  empty,
  linkPrefix = "/o/",
}: {
  query: Record<string, string | undefined>;
  empty: { title: string; body: string };
  linkPrefix?: string;
}) {
  const [items, setItems] = useState<ObsListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const key = JSON.stringify(query);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<Page>("/api/observations", { ...query, page: 1, pageSize: 50 })
      .then((d) => {
        if (!alive) return;
        setItems(d.items);
        setTotal(d.total);
        setPage(1);
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key]);

  async function more() {
    setLoading(true);
    try {
      const d = await api.get<Page>("/api/observations", { ...query, page: page + 1, pageSize: 50 });
      setItems((x) => [...x, ...d.items]);
      setPage(page + 1);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <ErrorNote error={error} />
      {!loading || items.length ? (
        items.length ? (
          <>
            <p className="small muted" aria-live="polite">
              {total} point{total === 1 ? "" : "s"}
            </p>
            <div className="section-flush obs-list">
              {items.map((o) => (
                <ObsRow key={o.id} o={o} to={`${linkPrefix}${o.id}`} fileUrl={api.file} />
              ))}
            </div>
            {items.length < total && (
              <button className="btn" onClick={more} disabled={loading}>
                {loading ? "Loading…" : `Show more (${total - items.length} left)`}
              </button>
            )}
          </>
        ) : (
          !error && (
            <div className="section">
              <Empty title={empty.title}>
                <p>{empty.body}</p>
              </Empty>
            </div>
          )
        )
      ) : (
        <Spinner />
      )}
    </div>
  );
}

const SITE_TABS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "awaiting", label: "Awaiting approval" },
  { key: "closed", label: "Closed" },
  { key: "raised", label: "Raised by me" },
  { key: "any", label: "All" },
];
const OWNER_TABS = [
  { key: "open", label: "To do" },
  { key: "overdue", label: "Overdue" },
  { key: "awaiting", label: "Submitted" },
  { key: "closed", label: "Closed" },
];

export function Observations() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const ownerView = s.isSupervisorOnly || params.get("scope") === "assigned";
  const tabs = ownerView ? OWNER_TABS : SITE_TABS.filter((t) => t.key !== "raised" || s.canRaiseAnywhere);
  const tab = params.get("tab") || (params.get("status") === "active" ? "open" : params.get("status")) || "open";
  const [q, setQ] = useState(params.get("q") ?? "");
  const type = params.get("type") ?? "";
  const risk = params.get("risk") ?? "";

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k === "tab") p.delete("status");
    setParams(p, { replace: true });
  };

  const query: Record<string, string | undefined> = {
    scope: ownerView ? "assigned" : tab === "raised" ? "raised" : "all",
    status: tab === "raised" ? "any" : tab,
    siteId: s.sites.length > 1 ? s.site?.id : undefined,
    type: type || undefined,
    risk: risk || undefined,
    q: params.get("q") || undefined,
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{ownerView ? "My points" : "Observations"}</h1>
          <p>{ownerView ? "Points assigned to you to close." : `${s.site?.name ?? "All sites"}`}</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => set("tab", t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <form
        className="row-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", q.trim());
        }}
      >
        <div className="row grow" style={{ minWidth: 200 }}>
          <input className="input" type="search" placeholder="Search ID, description or location" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search observations" />
          <button className="btn" aria-label="Search">
            <IconSearch />
          </button>
        </div>
        <select className="select" style={{ width: "auto" }} value={type} onChange={(e) => set("type", e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="unsafe_act">Unsafe act</option>
          <option value="unsafe_condition">Unsafe condition</option>
          <option value="near_miss">Near miss</option>
          <option value="safe_behaviour">Safe behaviour</option>
        </select>
        <select className="select" style={{ width: "auto" }} value={risk} onChange={(e) => set("risk", e.target.value)} aria-label="Risk level">
          <option value="">Any risk</option>
          <option>Critical</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
      </form>
      <ObservationList
        query={query}
        empty={{
          title: tab === "overdue" ? "Nothing overdue" : "No points here",
          body: ownerView ? "When a safety officer assigns you a point, it appears here." : "Try another tab or clear the filters.",
        }}
      />
    </div>
  );
}

export function Approvals() {
  const s = useSession();
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p>Closures submitted by supervisors, oldest first. You can't approve a closure you submitted yourself.</p>
        </div>
      </div>
      <ObservationList
        query={{ scope: "approvals", status: "awaiting", siteId: s.sites.length > 1 ? s.site?.id : undefined }}
        empty={{ title: "No closures to approve", body: "When a supervisor submits a closure, it waits here for your review." }}
      />
    </div>
  );
}
