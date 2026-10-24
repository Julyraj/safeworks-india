import { FormEvent, useState } from "react";
import { Field } from "../../shared/forms";
import { useToast } from "../../shared/ui";
import { api, errMsg, useAuth } from "../ctx";

export function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use both letters and numbers.";
  return null;
}

export default function ChangePassword() {
  const { me, refreshMe, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const issue = next ? passwordIssue(next) : null;
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (issue || mismatch) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/change-password", { currentPassword: current, newPassword: next });
      toast("Password changed");
      await refreshMe();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={submit}>
        <div className="brand">
          <span className="mark" aria-hidden /> Set a new password
        </div>
        <p className="muted">
          {me.name} ({me.employeeId}), your password was set by an admin. Choose your own before you continue.
        </p>
        <Field label="Current or temporary password" htmlFor="cur">
          <input id="cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" htmlFor="new" hint="At least 8 characters, with letters and numbers.">
          <input
            id="new"
            className="input"
            type="password"
            autoComplete="new-password"
            value={next}
            aria-invalid={!!issue}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        {issue && <p className="small" style={{ color: "var(--red)" }}>{issue}</p>}
        <Field label="Type the new password again" htmlFor="conf">
          <input id="conf" className="input" type="password" autoComplete="new-password" value={confirm} aria-invalid={mismatch} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        {mismatch && <p className="small" style={{ color: "var(--red)" }}>The two passwords do not match.</p>}
        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !current || !!issue || !next || mismatch || !confirm}>
          {busy ? "Saving…" : "Save new password"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
          Sign out
        </button>
      </form>
    </div>
  );
}
