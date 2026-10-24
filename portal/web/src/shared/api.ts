// Small fetch wrapper shared by the portal and the admin console.
// In the Android app (Capacitor) the pages are bundled, so API calls go to the server address saved on the device.

export const isNative = typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();

const SERVER_KEY = "sw:server";

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

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
  }
}

export interface Api {
  get<T = any>(path: string, query?: Record<string, string | number | boolean | undefined | null>): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  put<T = any>(path: string, body?: unknown): Promise<T>;
  patch<T = any>(path: string, body?: unknown): Promise<T>;
  upload<T = any>(path: string, form: FormData): Promise<T>;
  download(path: string, query?: Record<string, string | undefined>): Promise<Blob>;
  file(url: string | null | undefined): string;
  token(): string | null;
  setToken(t: string | null): void;
  onUnauthorized(fn: () => void): void;
}

export function createApi(tokenKey: string): Api {
  let unauthorized: (() => void) | null = null;
  const getToken = () => safeGet(tokenKey);

  function qs(query?: Record<string, any>): string {
    if (!query) return "";
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
    const headers: Record<string, string> = {};
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(serverBase() + path, { method, headers, body: payload });
    } catch {
      throw new ApiError(0, "No connection to the SafeWorks server. Check your network and try again.", "network");
    }
    if (raw && res.ok) return (await res.blob()) as T;
    let data: any = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && unauthorized) unauthorized();
      throw new ApiError(res.status, data?.error || `Request failed (${res.status}).`, data?.code, data?.details);
    }
    return data as T;
  }

  return {
    get: (p, q) => request("GET", p + qs(q)),
    post: (p, b) => request("POST", p, b ?? {}),
    put: (p, b) => request("PUT", p, b ?? {}),
    patch: (p, b) => request("PATCH", p, b ?? {}),
    upload: (p, f) => request("POST", p, f),
    download: (p, q) => request("GET", p + qs(q), undefined, true),
    file: (u) => (u ? (u.startsWith("http") ? u : serverBase() + u) : ""),
    token: getToken,
    setToken: (t) => safeSet(tokenKey, t),
    onUnauthorized: (fn) => {
      unauthorized = fn;
    },
  };
}

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export { safeGet, safeSet };
