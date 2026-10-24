import { FormEvent, useState } from "react";
import { ApiError, isNative, serverBase, setServerBase } from "../../shared/api";
import { Field } from "../../shared/forms";
import type { Me } from "../../shared/types";
import { api } from "../session";

export function Login({ onDone }: { onDone: () => void }) {
  const [emp, setEmp] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [server, setServer] = useState(serverBase());
  const [editServer, setEditServer] = useState(isNative && !serverBase());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (isNative) {
      if (!/^https?:\/\/.+/.test(server.trim())) {
        setErr("Enter the SafeWorks server address, e.g. https://safeworks.yourcompany.in");
        setEditServer(true);
        return;
      }
      setServerBase(server);
    }
    setBusy(true);
    try {
      const r = await api.post<{ token: string; mustChangePassword: boolean; user: Me }>("/api/auth/login", { employeeId: emp.trim(), password: pw, app: "portal" });
      api.setToken(r.token);
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <form className="login-card stack-lg" onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 6 }}>
          <div className="brand">
            <span className="mark" aria-hidden /> SafeWorks
          </div>
          <p className="muted">Site safety observations. Sign in with your employee ID.</p>
        </div>
        {err && (
          <div className="alert err" role="alert">
            {err}
          </div>
        )}
        {isNative && editServer && (
          <Field label="Server address" hint="Your admin gives you this once. Saved on this phone.">
            <input className="input" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://safeworks.yourcompany.in" value={server} onChange={(e) => setServer(e.target.value)} />
          </Field>
        )}
        <Field label="Employee ID" htmlFor="emp">
          <input id="emp" className="input" autoComplete="username" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={emp} onChange={(e) => setEmp(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="pw">
          <div className="row">
            <input id="pw" className="input grow" type={show ? "text" : "password"} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <button type="button" className="btn btn-sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !emp.trim() || !pw}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="small muted">
          Forgot your password? Ask your admin to reset it from the admin console. After 5 wrong attempts the account locks for 15 minutes.
        </p>
        {isNative && !editServer && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditServer(true)}>
            Server: {serverBase() || "not set"} · change
          </button>
        )}
      </form>
    </main>
  );
}

export function ChangePassword({ me, onDone, forced, onCancel }: { me: Pick<Me, "name" | "employeeId">; onDone: () => void; forced?: boolean; onCancel?: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const rule = next.length >= 8 && /[A-Za-z]/.test(next) && /[0-9]/.test(next);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!rule) return setErr("Use at least 8 characters with letters and numbers.");
    if (next !== confirm) return setErr("The two new passwords do not match.");
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword: cur, newPassword: next });
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <div className="stack" style={{ gap: 6 }}>
        <h1>{forced ? "Set your own password" : "Change password"}</h1>
        <p className="muted">
          {forced ? `Welcome, ${me.name}. Replace the temporary password your admin gave you before you continue.` : `${me.name} (${me.employeeId})`}
        </p>
      </div>
      {err && (
        <div className="alert err" role="alert">
          {err}
        </div>
      )}
      <Field label={forced ? "Temporary password" : "Current password"} htmlFor="cur">
        <input id="cur" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
      </Field>
      <Field label="New password" htmlFor="new" hint={<span style={{ color: next && !rule ? "var(--red)" : undefined }}>At least 8 characters, with letters and numbers.</span>}>
        <input id="new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </Field>
      <Field label="Type the new password again" htmlFor="confirm">
        <input id="confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <div className="row-wrap">
        <button className="btn btn-primary" disabled={busy || !cur || !next || !confirm}>
          {busy ? "Saving…" : "Save new password"}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <p className="small muted">Saving signs you out on your other devices.</p>
    </form>
  );
  if (!forced) return form;
  return (
    <main className="login-wrap">
      <div className="login-card">{form}</div>
    </main>
  );
}
