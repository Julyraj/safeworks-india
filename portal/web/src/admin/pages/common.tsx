import type { ReactNode } from "react";
import { daysAgo, todayLocal } from "../../shared/format";
import { useLoad } from "../../shared/ui";
import { api } from "../ctx";
import type { AdminContractor, AdminSite, RoleMeta } from "../types";

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}

export const PERIODS = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];

export function periodRange(days: number): { from: string; to: string } {
  return { from: daysAgo(days - 1), to: todayLocal() };
}

export function PeriodSelect({ days, onChange, id = "period" }: { days: number; onChange: (d: number) => void; id?: string }) {
  return (
    <div className="field" style={{ minWidth: 170 }}>
      <label htmlFor={id}>Period</label>
      <select id={id} className="select" value={days} onChange={(e) => onChange(Number(e.target.value))}>
        {PERIODS.map((p) => (
          <option key={p.days} value={p.days}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function useAdminSites() {
  return useLoad<{ sites: AdminSite[] }>(() => api.get("/api/admin/sites"), []);
}

export function useContractors() {
  return useLoad<{ contractors: AdminContractor[] }>(() => api.get("/api/admin/contractors"), []);
}

export function useRoles() {
  return useLoad<{ roles: RoleMeta[] }>(() => api.get("/api/admin/roles"), []);
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="small muted" style={{ marginTop: 10 }}>{total} {total === 1 ? "record" : "records"}</p>;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span className="small muted">
        {from}–{to} of {total}
      </span>
      <div className="row">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="small">
          Page {page} of {pages}
        </span>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
