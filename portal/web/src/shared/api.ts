/* Fetch wrapper shared by the field app, the QR form and the admin console.
   - Bearer token from storage; `Accept-Language` from the chosen language so server messages come back translated.
   - Errors are `ApiError` with the server's `code`; a network failure is code "network" (status 0).
   - GET requests retry once on a network error; writes never retry (the sync outbox owns that).
   - In the Android app (Capacitor) the pages are bundled, so API calls go to the server address saved on the device. */
import type { ApiError as ApiErrorBody } from "./types";
import { safeGet, safeSet } from "./storage";
import { readSavedLang } from "./i18n";

export const isNative = typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();
const SERVER_KEY = "sw.server";
export const API_PREFIX = "/api/v1";

export function serverBase(): string {
  if (!isNative) return "";
  return (safeGet(SERVER_KEY) || "").replace(/\/+$/, "");
}
export function setServerBase(url: string) {
  safeSet(SERVER_KEY, url.trim().replace(/\/+$/, ""));
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() { return this.status === 0; }
  get isAuth() { return this.status === 401; }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface Api {
  get<T = unknown>(path: string, query?: Query): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** Raw bytes upload (PUT /media/{clientUuid} and public upload tickets). `url` may be absolute. */
  putBytes<T = unknown>(url: string, data: Blob | ArrayBuffer, contentType: string): Promise<T>;
  /** Downloads a file (CSV export, HTML report) as a Blob. */
  download(path: string, query?: Query): Promise<Blob>;
  /** Resolves a server file/report URL for <img src> or <a href>. */
  file(url: string | null | undefined): string;
  token(): string | null;
  setToken(t: string | null): void;
  onUnauthorized(fn: () => void): void;
}

export function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function networkError(): ApiError {
  return new ApiError(0, "No connection to the SafeWorks server.", "network");
}

export function createApi(tokenKey: string): Api {
  let unauthorized: (() => void) | null = null;
  const getToken = () => safeGet(tokenKey);

  async function request<T>(method: string, url: string, body?: unknown, opts: { raw?: boolean; bytes?: { data: Blob | ArrayBuffer; type: string }; retry?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { "Accept-Language": readSavedLang() };
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    let payload: BodyInit | undefined;
    if (opts.bytes) {
      headers["Content-Type"] = opts.bytes.type;
      payload = opts.bytes.data;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const full = url.startsWith("http") ? url : serverBase() + url;
    let res: Response;
    try {
      res = await fetch(full, { method, headers, body: payload, credentials: "omit" });
    } catch {
      if (opts.retry) {
        await new Promise((r) => setTimeout(r, 400));
        try {
          res = await fetch(full, { method, headers, body: payload, credentials: "omit" });
        } catch {
          throw networkError();
        }
      } else throw networkError();
    }
    if (opts.raw && res.ok) return (await res.blob()) as T;
    let data: (ApiErrorBody & Record<string, unknown>) | null = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && unauthorized) unauthorized();
      const code = data?.code || (res.status === 429 ? "rate_limited" : res.status === 413 ? "too_large" : res.status === 404 ? "not_found" : "error");
      throw new ApiError(res.status, data?.error || `Request failed (${res.status}).`, code, data?.details);
    }
    return data as T;
  }

  return {
    get: (p, q) => request("GET", API_PREFIX + p + qs(q), undefined, { retry: true }),
    post: (p, b) => request("POST", API_PREFIX + p, b ?? {}),
    put: (p, b) => request("PUT", API_PREFIX + p, b ?? {}),
    del: (p, b) => request("DELETE", API_PREFIX + p, b),
    putBytes: (url, data, type) => request("PUT", url.startsWith("/api") || url.startsWith("http") ? url : API_PREFIX + url, undefined, { bytes: { data, type } }),
    download: (p, q) => request("GET", API_PREFIX + p + qs(q), undefined, { raw: true, retry: true }),
    file: (u) => (u ? (u.startsWith("http") ? u : serverBase() + u) : ""),
    token: getToken,
    setToken: (t) => safeSet(tokenKey, t),
    onUnauthorized: (fn) => { unauthorized = fn; },
  };
}

/** Maps an error to a translation key the UI can show (plus the server message when there is one). */
export function errorKey(e: unknown): { key: string; message: string } {
  if (e instanceof ApiError) {
    if (e.isNetwork) return { key: "error.network", message: e.message };
    if (e.status === 401) return { key: "error.unauthorized", message: e.message };
    if (e.status === 403) return { key: "error.forbidden", message: e.message };
    if (e.status === 404) return { key: "error.notFound", message: e.message };
    if (e.status === 429) return { key: "error.rateLimited", message: e.message };
    if (e.status === 413) return { key: "error.tooLarge", message: e.message };
    return { key: "error.generic", message: e.message };
  }
  return { key: "error.generic", message: e instanceof Error ? e.message : String(e) };
}
