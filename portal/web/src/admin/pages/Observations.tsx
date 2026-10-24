import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Select } from "../../shared/forms";
import { TYPE_LABEL } from "../../shared/format";
import type { ObsListItem } from "../../shared/types";
import { Empty, ErrorNote, ObsRow, Spinner, useLoad } from "../../shared/ui";
import { api } from "../ctx";
import { PageHead, Pager, useAdminSites } from "./common";

const STATUS_OPTIONS = [
  { value: "any", label: "All except cancelled" },
  { value: "active", label: "Open, in progress or awaiting" },
  { value: "open", label: "Open and in progress" },
  { value: "overdue", label: "Overdue" },
  { value: "awaiting", label: "Awaiting approval" },
  { value: "closed", label: "Closed" },
  { value: "noted", label: "Safe behaviour (noted)" },
  { value: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 50;

export default function Observations() {
  const [sp, setSp] = useSearchParams();
  const sites = useAdminSites();
  const f = {
    siteId: sp.get("siteId") ?? "",
    status: sp.get("status") ?? "any",
    type: sp.get("type") ?? "",
    risk: sp.get("risk") ?? "",
    q: sp.get("q") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    page: Number(sp.get("page") ?? "1") || 1,
  };
  const [q, setQ] = useState(f.q);
  useEffect(() => setQ(f.q), [f.q]);

  const key = sp.toString();
  const { data, error, loading } = useLoad<{ items: ObsListItem[]; total: number; page: number; pageSize: number }>(
    () =>
      api.get("/api/observations", {
        siteId: f.siteId || undefined,
        status: f.status,
        type: f.type || undefined,
        risk: f.risk || undefined,
        q: f.q || undefined,
        from: f.from || undefined,
        to: f.to || undefined,
        page: f.page,
        pageSize: PAGE_SIZE,
      }),
    [key],
  );

  function set(k: string, v: string) {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setSp(next, { replace: true });
  }

  function search(e: FormEvent) {
    e.preventDefault();
    set("q", q.trim());
  }

  const hasFilters = !!(f.siteId || f.type || f.risk || f.q || f.from || f.to || f.status !== "any");

  return (
    <div>
      <PageHead title="Observations" sub="Every observation across all sites. Open one to see photos, closure, history and actions." />
      <div className="filters" role="search">
        <div className="field">
          <label htmlFor="f-site">Site</label>
          <Select
            id="f-site"
            value={f.siteId}
            onChange={(v) => set("siteId", v)}
            placeholder="All sites"
            options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
          />
        </div>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" className="select" value={f.status} onChange={(e) => set("status", e.target.value)}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-type">Type</label>
          <Select id="f-type" value={f.type} onChange={(v) => set("type", v)} placeholder="All types" options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="field">
          <label htmlFor="f-risk">Risk</label>
          <Select id="f-risk" value={f.risk} onChange={(v) => set("risk", v)} placeholder="All risk levels" options={["Critical", "High", "Medium", "Low"].map((v) => ({ value: v, label: v }))} />
        </div>
        <div className="field">
          <label htmlFor="f-from">Raised from</label>
          <input id="f-from" type="date" className="input" value={f.from} onChange={(e) => set("from", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-to">Raised to</label>
          <input id="f-to" type="date" className="input" value={f.to} onChange={(e) => set("to", e.target.value)} />
        </div>
        <form className="field" onSubmit={search} style={{ gridColumn: "span 2" }}>
          <label htmlFor="f-q">Search</label>
          <div className="row">
            <input id="f-q" className="input grow" placeholder="ID, description, item or location" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn">Search</button>
          </div>
        </form>
        {hasFilters && (
          <button className="btn btn-ghost" onClick={() => setSp(new URLSearchParams(), { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      <ErrorNote error={error} />
      {loading && !data && <Spinner />}
      {data && (
        <>
          {data.items.length === 0 ? (
            <div className="section">
              <Empty title="No observations match these filters">
                <p>Widen the date range or clear the filters.</p>
              </Empty>
            </div>
          ) : (
            <div className="section-flush obs-list" style={loading ? { opacity: 0.6 } : undefined}>
              {data.items.map((o) => (
                <ObsRow key={o.id} o={o} to={`/observations/${o.id}`} fileUrl={api.file} />
              ))}
            </div>
          )}
          <Pager page={f.page} pageSize={PAGE_SIZE} total={data.total} onPage={(p) => set("page", String(p))} />
        </>
      )}
    </div>
  );
}
