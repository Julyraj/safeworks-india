import { createContext, useContext } from "react";
import { createApi } from "../shared/api";
import type { Me } from "../shared/types";

/** Admin console sessions use their own token, separate from the portal's. */
export const api = createApi("sw:atoken");

export interface AuthCtx {
  me: Me;
  canWrite: boolean;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

export const Auth = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = useContext(Auth);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}

export function isAdminRole(me: Me): boolean {
  return me.roles.some((r) => r.role === "platform_admin" || r.role === "org_admin");
}

/** Save a Blob as a file in the browser. */
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
