import { FormEvent, useEffect, useState } from "react";
import { Field } from "../../shared/forms";
import { ErrorNote, Risk, Spinner, useLoad, useToast } from "../../shared/ui";
import { api, errMsg, useAuth } from "../ctx";
import type { OrgSettings } from "../types";
import { PageHead } from "./common";

const LEVELS = ["Critical", "High", "Medium", "Low"] as const;

export default function Settings() {
  const { canWrite, refreshMe } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad<{ companyName: string; settings: OrgSettings }>(() => api.get("/api/admin/settings"), []);
  const [name, setName] = useState("");
  const [s, setS] = useState<OrgSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (data) {
      setName(data.companyName);
      setS(data.settings);
    }
  }, [data]);

  const order = s ? s.dueDays.Critical <= s.dueDays.High && s.dueDays.High <= s.dueDays.Medium && s.dueDays.Medium <= s.dueDays.Low : true;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setErr("");
    try {
      await api.put("/api/admin/settings", { companyName: name.trim(), dueDays: s.dueDays, escalation: s.escalation, dueReminderHours: s.dueReminderHours });
      toast("Settings saved");
      reload();
      await refreshMe();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHead title="Settings" sub="Company-wide rules. Changes apply to observations raised from now on; existing due dates are not moved." />
      <ErrorNote error={error} />
      {loading && !data && <Spinner />}
      {s && (
        <form className="stack-lg" onSubmit={save} style={{ maxWidth: 760 }}>
          <fieldset disabled={!canWrite} className="stack-lg" style={{ border: 0, padding: 0, margin: 0 }}>
            <section className="section stack">
              <h3>Company</h3>
              <Field label="Company name" htmlFor="co" hint="Shown in the app, the admin console and reports.">
                <input id="co" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} />
              </Field>
            </section>

            <section className="section stack">
              <h3>Due dates by risk level</h3>
              <p className="small muted">How many days the action owner gets to close a point, counted from when it is raised. The safety officer can still pick another date or extend it with a reason.</p>
              <div className="grid-2">
                {LEVELS.map((lv) => (
                  <Field key={lv} label={`${lv} risk`} htmlFor={`dd-${lv}`}>
                    <div className="row">
                      <Risk level={lv} />
                      <input
                        id={`dd-${lv}`}
                        className="input"
                        type="number"
                        min={1}
                        max={365}
                        style={{ maxWidth: 120 }}
                        value={s.dueDays[lv]}
                        onChange={(e) => setS({ ...s, dueDays: { ...s.dueDays, [lv]: Number(e.target.value) } })}
                        required
                      />
                      <span className="muted">{s.dueDays[lv] === 1 ? "day" : "days"}</span>
                    </div>
                  </Field>
                ))}
              </div>
              {!order && <div className="alert warn">A lower risk level should not get less time than a higher one (Critical ≤ High ≤ Medium ≤ Low).</div>}
            </section>

            <section className="section stack">
              <h3>Reminders and escalation</h3>
              <div className="grid-2">
                <Field label="Remind the action owner before the due date" htmlFor="rem" hint="Hours before the due date.">
                  <input
                    id="rem"
                    className="input"
                    type="number"
                    min={1}
                    max={168}
                    value={s.dueReminderHours}
                    onChange={(e) => setS({ ...s, dueReminderHours: Number(e.target.value) })}
                    required
                  />
                </Field>
                <Field label="Email the site head when overdue by" htmlFor="esc1" hint="Days overdue. Uses the site head email on the site.">
                  <input
                    id="esc1"
                    className="input"
                    type="number"
                    min={1}
                    max={90}
                    value={s.escalation.siteHeadDays}
                    onChange={(e) => setS({ ...s, escalation: { ...s.escalation, siteHeadDays: Number(e.target.value) } })}
                    required
                  />
                </Field>
                <Field label="Notify company admins when overdue by" htmlFor="esc2" hint="Days overdue.">
                  <input
                    id="esc2"
                    className="input"
                    type="number"
                    min={1}
                    max={180}
                    value={s.escalation.adminDays}
                    onChange={(e) => setS({ ...s, escalation: { ...s.escalation, adminDays: Number(e.target.value) } })}
                    required
                  />
                </Field>
              </div>
            </section>
          </fieldset>
          {err && (
            <div className="alert err" role="alert">
              {err}
            </div>
          )}
          {canWrite && (
            <div>
              <button className="btn btn-primary" disabled={busy || !order}>
                {busy ? "Saving…" : "Save settings"}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
