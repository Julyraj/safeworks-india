import { FormEvent, useState } from "react";
import type { Me } from "../../shared/types";
import { Field } from "../../shared/forms";
import { api, errMsg } from "../ctx";

export default function Login({ onLogin }: { onLogin: (token: string, me: Me) => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ token: string; user: Me }>("/api/auth/login", { employeeId: employeeId.trim(), password, app: "admin" });
      onLogin(r.token, r.user);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit} aria-labelledby="admin-login-title">
        <div className="brand" id="admin-login-title">
          <span className="mark" aria-hidden /> SafeWorks admin
        </div>
        <p className="muted">Sign in with your employee ID. This console is for named admins and management viewers.</p>
        <Field label="Employee ID" htmlFor="emp">
          <input
            id="emp"
            className="input"
            autoComplete="username"
            autoCapitalize="characters"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            required
          />
        </Field>
        <Field label="Password" htmlFor="pw">
          <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !employeeId.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="small muted">Forgot your password? Another admin can reset it for you. Site staff sign in on the SafeWorks app, not here.</p>
      </form>
    </div>
  );
}
