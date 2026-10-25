/* The console's API client: one `createApi` instance keyed on the admin token plus a few helpers the registers share. */
import { createApi, ApiError, type Query } from "../shared/api";
import type { Paged } from "../shared/types";
import { csvEscape } from "../shared/format";

export const TOKEN_KEY = "sw.admin.token";
export const api = createApi(TOKEN_KEY);
export { ApiError };

/** Some list routes answer a bare array, others `Paged<T>`; the console accepts both. */
export function asList<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object" && Array.isArray((r as Paged<T>).items)) return (r as Paged<T>).items;
  return [];
}
export function asPaged<T>(r: unknown, page: number, pageSize: number): Paged<T> {
  if (Array.isArray(r)) return { items: r as T[], total: r.length, page, pageSize };
  const p = r as Paged<T>;
  return { items: p?.items ?? [], total: p?.total ?? p?.items?.length ?? 0, page: p?.page ?? page, pageSize: p?.pageSize ?? pageSize };
}

/** Human message from any thrown value (server messages come translated through Accept-Language). */
export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
export function errCode(e: unknown): string {
  return e instanceof ApiError ? e.code : "error";
}

/** Saves a Blob to the user's downloads. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Server CSV export (UTF-8 with BOM, audit `export` on the server). */
export async function downloadCsv(path: string, query: Query, filename: string) {
  const blob = await api.download(path, query);
  saveBlob(blob, filename);
}

/** Client-side CSV for the screens the server has no export route for (dashboard view, config tables). */
export function localCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(","))];
  saveBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), filename);
}

/** Opens a server HTML page (poster, inspection report) in a new tab with the bearer token passed as a query so the tab can load it. */
export function openServerHtml(path: string, query: Query = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const t = api.token();
  if (t) q.set("access_token", t);
  const url = `/api/v1${path}?${q.toString()}`;
  window.open(url, "_blank", "noopener");
}

/** Tiny CSV parser (RFC 4180: quotes, doubled quotes, CRLF). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function toIsoDate(d: Date): string {
  return d.toISOString();
}
export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
export function datetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 16);
}
/** datetime-local (interpreted as IST) → ISO UTC */
export function fromDatetimeLocal(v: string): string {
  if (!v) return "";
  return new Date(v + ":00+05:30").toISOString();
}
