import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Api } from "./api";
import { ACTION_LABEL, dueText, FIELD_LABEL, fmtDate, fmtDateTime, SEVERITY, LIKELIHOOD, todayLocal } from "./format";
import { Field, PhotoPicker, PickedPhoto, RiskMatrix, Select } from "./forms";
import { stampText } from "./image";
import { ErrorNote, Lightbox, Risk, Sheet, Spinner, StatusPill, useLoad, useToast } from "./ui";
import type { Master, ObsDetail, Site } from "./types";

type SheetKind = null | "closure" | "decide" | "assign" | "extend" | "cancel" | "reopen" | "edit";

export function ObservationView({ api, id, me, linkPrefix }: { api: Api; id: string; me: { id: string; name: string }; linkPrefix: string }) {
  const { data: o, error, loading, setData } = useLoad<ObsDetail>(() => api.get(`/api/observations/${id}`), [id]);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (loading && !o) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!o) return null;

  const evidence = o.photos.filter((p) => p.kind === "evidence");
  const due = dueText(o.dueAt, o.status);
  const pending = o.closures.find((c) => c.decision === "pending");

  async function act(fn: () => Promise<ObsDetail>, done: string): Promise<boolean> {
    setBusy(true);
    try {
      const next = await fn();
      setData(next);
      setSheet(null);
      toast(done);
      return true;
    } catch (e: any) {
      toast(e.message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <header className="stack" style={{ gap: 8 }}>
        <div className="row-wrap">
          <span className="code">{o.code}</span>
          <StatusPill status={o.status} overdue={o.overdue} />
          <Risk level={o.riskLevel} />
          <span className="pill">{o.typeLabel}</span>
          {o.workStopped && <span className="pill overdue">Work stopped</span>}
          {o.repeatOf && (
            <Link className="pill" to={`${linkPrefix}${o.repeatOf.id}`}>
              Repeat of {o.repeatOf.code}
            </Link>
          )}
        </div>
        <h1 style={{ fontSize: "1.6rem" }}>{o.item || o.hazard || o.typeLabel}</h1>
        <p className="muted">
          {o.site.name}
          {o.area ? ` · ${o.area}` : ""}
          {o.location ? ` · ${o.location}` : ""}
        </p>
        {["open", "in_progress"].includes(o.status) && <p className={due.late ? "due-late" : ""}>{due.text} ({fmtDateTime(o.dueAt)})</p>}
        {o.status === "closed" && <p style={{ color: "var(--green)", fontWeight: 600 }}>Closed {fmtDateTime(o.closedAt)} by {o.closedBy}</p>}
        {o.status === "cancelled" && <div className="alert warn">Cancelled: {o.cancelReason}</div>}
      </header>

      {evidence.length > 0 && (
        <div className="gallery">
          {evidence.map((p, i) => (
            <figure key={p.id} style={p.withdrawn ? { opacity: 0.45 } : undefined}>
              <img src={api.file(p.url)} alt={`Evidence photo ${i + 1}`} onClick={() => setZoom(api.file(p.url))} />
              <figcaption>{p.withdrawn ? `Withdrawn: ${p.withdrawnReason}` : `Photo ${i + 1} · ${fmtDateTime(p.uploadedAt)}`}</figcaption>
            </figure>
          ))}
        </div>
      )}

      <Actions o={o} busy={busy} onSheet={setSheet} onStart={() => act(() => api.post(`/api/observations/${o.id}/start`), "Marked as in progress")} />

      {pending && (
        <section className="section" style={{ borderColor: "var(--blue)" }}>
          <h3>Closure waiting for approval</h3>
          <ClosureBlock o={o} closureId={pending.id} api={api} onZoom={setZoom} />
        </section>
      )}

      <section className="section">
        <h3>What was observed</h3>
        <p style={{ whiteSpace: "pre-wrap" }}>{o.description}</p>
        <div className="divider" style={{ margin: "14px 0" }} />
        <dl className="kv">
          <dt>Category</dt>
          <dd>{o.category || "—"}</dd>
          <dt>Hazard</dt>
          <dd>{o.hazard || "—"}</dd>
          <dt>Work activity</dt>
          <dd>{o.activity || "—"}</dd>
          {o.lsr && (
            <>
              <dt>Life-Saving Rule breached</dt>
              <dd>{o.lsr}</dd>
            </>
          )}
          {o.permitType && (
            <>
              <dt>Permit</dt>
              <dd>
                {o.permitType} {o.permitNo}
              </dd>
            </>
          )}
          {o.equipment && (
            <>
              <dt>Equipment</dt>
              <dd>{o.equipment}</dd>
            </>
          )}
          {o.personObserved && (
            <>
              <dt>Person observed</dt>
              <dd>{o.personObserved}</dd>
            </>
          )}
          <dt>Contractor</dt>
          <dd>{o.contractorName || "—"}</dd>
          {o.severity && (
            <>
              <dt>Risk</dt>
              <dd>
                Severity {o.severity} ({SEVERITY[o.severity - 1]}) × likelihood {o.likelihood} ({LIKELIHOOD[(o.likelihood ?? 1) - 1]}) = {o.riskScore} <Risk level={o.riskLevel} />
              </dd>
            </>
          )}
          <dt>Immediate action</dt>
          <dd>{o.immediateAction || "—"}</dd>
          {o.type !== "safe_behaviour" && (
            <>
              <dt>Likely root cause</dt>
              <dd>{o.rootCause || "—"}</dd>
              <dt>Corrective action</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{o.correctiveAction || "—"}</dd>
              <dt>Control level</dt>
              <dd>{o.controlLevel || "—"}</dd>
              <dt>Action owner</dt>
              <dd>{o.owner ? `${o.owner.name}${o.owner.designation ? `, ${o.owner.designation}` : ""}` : "Not assigned yet"}</dd>
              <dt>Due</dt>
              <dd>
                {fmtDateTime(o.dueAt)}
                {o.originalDueAt ? ` (originally ${fmtDate(o.originalDueAt)})` : ""}
              </dd>
            </>
          )}
          {o.legalRef && (
            <>
              <dt>Legal / standard reference</dt>
              <dd>{o.legalRef}</dd>
            </>
          )}
          <dt>Raised by</dt>
          <dd>
            {o.raisedBy.name}, {o.raisedBy.designation} ({o.raisedBy.employeeId}) · {fmtDateTime(o.raisedAt)}
          </dd>
          <dt>Observed at</dt>
          <dd>{fmtDateTime(o.observedAt)}</dd>
          {o.round && (
            <>
              <dt>Safety walk</dt>
              <dd className="code">{o.round.code}</dd>
            </>
          )}
        </dl>
      </section>

      {o.closures.filter((c) => c.decision !== "pending").length > 0 && (
        <section className="section">
          <h3>Closure history</h3>
          <div className="stack">
            {o.closures
              .filter((c) => c.decision !== "pending")
              .reverse()
              .map((c) => (
                <div key={c.id} className="stack" style={{ gap: 6, paddingBottom: 12, borderBottom: "1px solid var(--line)" }}>
                  <div className="row-wrap">
                    <strong>Attempt {c.attempt}</strong>
                    <span className={`pill ${c.decision === "approved" ? "s-closed" : "overdue"}`}>{c.decision === "approved" ? "Approved" : "Rejected"}</span>
                    {c.onsiteVerified && <span className="pill">Verified on site</span>}
                  </div>
                  <ClosureBlock o={o} closureId={c.id} api={api} onZoom={setZoom} compact />
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="section">
        <h3>Comments</h3>
        <div className="stack">
          {o.comments.length === 0 && <p className="muted small">No comments yet.</p>}
          {o.comments.map((c) => (
            <div key={c.id}>
              <div className="small muted">
                <strong style={{ color: "var(--ink)" }}>{c.user}</strong> · {fmtDateTime(c.at)}
              </div>
              <p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p>
            </div>
          ))}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              act(() => api.post(`/api/observations/${o.id}/comments`, { body: comment.trim() }), "Comment added").then((ok) => ok && setComment(""));
            }}
          >
            <input className="input grow" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
            <button className="btn" disabled={busy || !comment.trim()}>
              Post
            </button>
          </form>
        </div>
      </section>

      <section className="section">
        <h3>History</h3>
        <ol className="timeline">
          {o.timeline.map((t) => (
            <li key={t.id}>
              <div>
                <div>
                  <strong>{ACTION_LABEL[t.action] ?? t.action}</strong> <span className="muted small">v{t.version}</span>
                </div>
                <div className="small muted">
                  {t.actor ?? "System"} · {fmtDateTime(t.at)}
                </div>
                {t.reason && <div className="small">Reason: {t.reason}</div>}
                {Object.keys(t.changes || {}).length > 0 && t.action !== "created" && (
                  <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {Object.entries(t.changes)
                      .filter(([k]) => !["assigned_at", "category_code", "item_code"].includes(k))
                      .map(([k, [a, b]]) => (
                        <li key={k}>
                          {FIELD_LABEL[k] ?? k}: {fmtVal(k, a)} → {fmtVal(k, b)}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {sheet === "closure" && (
        <ClosureSheet
          busy={busy}
          stamp={stampText(o.site.name, me.name)}
          onClose={() => setSheet(null)}
          onSubmit={(form) => act(() => api.upload(`/api/observations/${o.id}/closure`, form), "Closure submitted for approval")}
        />
      )}
      {sheet === "decide" && pending && (
        <Sheet title="Approve or reject closure" onClose={() => setSheet(null)} wide>
          <DecideForm o={o} api={api} busy={busy} onZoom={setZoom} onDecide={(body, msg) => act(() => api.post(`/api/observations/${o.id}/decision`, body), msg)} />
        </Sheet>
      )}
      {sheet === "assign" && <AssignSheet api={api} o={o} busy={busy} onClose={() => setSheet(null)} onSave={(ownerId) => act(() => api.patch(`/api/observations/${o.id}`, { ownerId }), "Action owner assigned")} />}
      {sheet === "extend" && (
        <ExtendSheet o={o} busy={busy} onClose={() => setSheet(null)} onSave={(dueAt, reason) => act(() => api.post(`/api/observations/${o.id}/extend`, { dueAt, reason }), "Due date extended")} />
      )}
      {sheet === "cancel" && (
        <ReasonSheet
          title="Cancel observation"
          hint="Use for duplicates or points raised in error. It leaves the counts but stays in the audit trail."
          action="Cancel observation"
          danger
          busy={busy}
          onClose={() => setSheet(null)}
          onSave={(reason) => act(() => api.post(`/api/observations/${o.id}/cancel`, { reason }), "Observation cancelled")}
        />
      )}
      {sheet === "reopen" && (
        <ReasonSheet
          title="Reopen observation"
          hint="Reopen when the same hazard is found again after closure."
          action="Reopen"
          busy={busy}
          onClose={() => setSheet(null)}
          onSave={(reason) => act(() => api.post(`/api/observations/${o.id}/reopen`, { reason }), "Observation reopened")}
        />
      )}
      {sheet === "edit" && <EditSheet api={api} o={o} busy={busy} onClose={() => setSheet(null)} onSave={(body) => act(() => api.patch(`/api/observations/${o.id}`, body), "Changes saved as a new version")} />}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

function fmtVal(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (k.endsWith("_at") && typeof v === "string") return fmtDateTime(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (k.endsWith("_id") && typeof v === "string") return "changed";
  return String(v);
}

function Actions({ o, busy, onSheet, onStart }: { o: ObsDetail; busy: boolean; onSheet: (s: SheetKind) => void; onStart: () => void }) {
  const c = o.can;
  const any = c.start || c.submitClosure || c.decide || c.assign || c.extend || c.edit || c.cancel || c.reopen;
  if (!any) return null;
  return (
    <div className="row-wrap">
      {c.decide && (
        <button className="btn btn-primary" onClick={() => onSheet("decide")} disabled={busy}>
          Review closure
        </button>
      )}
      {c.submitClosure && (
        <button className={`btn ${c.decide ? "" : "btn-primary"}`} onClick={() => onSheet("closure")} disabled={busy}>
          Submit closure
        </button>
      )}
      {c.start && (
        <button className="btn" onClick={onStart} disabled={busy}>
          Start work
        </button>
      )}
      {c.assign && (
        <button className="btn" onClick={() => onSheet("assign")} disabled={busy}>
          {o.owner ? "Reassign" : "Assign owner"}
        </button>
      )}
      {c.extend && (
        <button className="btn" onClick={() => onSheet("extend")} disabled={busy}>
          Extend due date
        </button>
      )}
      {c.edit && (
        <button className="btn" onClick={() => onSheet("edit")} disabled={busy}>
          Edit
        </button>
      )}
      {c.reopen && (
        <button className="btn" onClick={() => onSheet("reopen")} disabled={busy}>
          Reopen
        </button>
      )}
      {c.cancel && (
        <button className="btn btn-ghost btn-danger" onClick={() => onSheet("cancel")} disabled={busy}>
          Cancel point
        </button>
      )}
    </div>
  );
}

function ClosureBlock({ o, closureId, api, onZoom, compact }: { o: ObsDetail; closureId: string; api: Api; onZoom: (u: string) => void; compact?: boolean }) {
  const c = o.closures.find((x) => x.id === closureId)!;
  const before = o.photos.filter((p) => p.kind === "evidence" && !p.withdrawn);
  const after = o.photos.filter((p) => p.closureId === closureId && !p.withdrawn);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p style={{ whiteSpace: "pre-wrap" }}>{c.comment}</p>
      <p className="small muted">
        Submitted by {c.submittedBy} · {fmtDateTime(c.submittedAt)} · completed {fmtDate(c.completedOn)}
        {c.controlLevel ? ` · control: ${c.controlLevel}` : ""}
      </p>
      {c.decidedBy && (
        <p className="small">
          {c.decision === "approved" ? "Approved" : "Rejected"} by {c.decidedBy} · {fmtDateTime(c.decidedAt)}
          {c.remarks ? ` — ${c.remarks}` : ""}
        </p>
      )}
      {!compact && (
        <div className="grid-2">
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              Before
            </div>
            <div className="gallery">
              {before.map((p) => (
                <img key={p.id} src={api.file(p.url)} alt="Before" onClick={() => onZoom(api.file(p.url))} />
              ))}
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              After
            </div>
            {after.length ? (
              <div className="gallery">
                {after.map((p) => (
                  <img key={p.id} src={api.file(p.url)} alt="After" onClick={() => onZoom(api.file(p.url))} />
                ))}
              </div>
            ) : (
              <p className="small muted">No closure photo added.</p>
            )}
          </div>
        </div>
      )}
      {compact && after.length > 0 && (
        <div className="gallery">
          {after.map((p) => (
            <img key={p.id} src={api.file(p.url)} alt="After" onClick={() => onZoom(api.file(p.url))} />
          ))}
        </div>
      )}
    </div>
  );
}

function DecideForm({ o, api, busy, onZoom, onDecide }: { o: ObsDetail; api: Api; busy: boolean; onZoom: (u: string) => void; onDecide: (body: object, msg: string) => void }) {
  const pending = o.closures.find((c) => c.decision === "pending")!;
  const [remarks, setRemarks] = useState("");
  const [verified, setVerified] = useState(o.riskLevel === "High" || o.riskLevel === "Critical");
  return (
    <div className="stack">
      <ClosureBlock o={o} closureId={pending.id} api={api} onZoom={onZoom} />
      <Field label="Remarks" hint="Required when rejecting: say what is still not right.">
        <textarea className="textarea" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <label className="checkline">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        <span>I checked it physically on site{o.riskLevel === "High" || o.riskLevel === "Critical" ? " (recommended for High and Critical)" : ""}</span>
      </label>
      <div className="row-wrap">
        <button className="btn btn-good" disabled={busy} onClick={() => onDecide({ decision: "approve", remarks, onsiteVerified: verified }, "Approved – observation closed")}>
          Approve and close
        </button>
        <button
          className="btn btn-danger"
          disabled={busy || remarks.trim().length < 3}
          onClick={() => onDecide({ decision: "reject", remarks, onsiteVerified: verified }, "Closure rejected – sent back to the owner")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function ClosureSheet({ busy, stamp, onClose, onSubmit }: { busy: boolean; stamp: string; onClose: () => void; onSubmit: (f: FormData) => void }) {
  const [comment, setComment] = useState("");
  const [completedOn, setCompletedOn] = useState(todayLocal());
  const [control, setControl] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  return (
    <Sheet title="Submit closure" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData();
          f.append("data", JSON.stringify({ comment, completedOn, controlLevel: control }));
          photos.forEach((p, i) => f.append("photos", p.blob, `closure-${i + 1}.jpg`));
          onSubmit(f);
        }}
      >
        <Field label="What was done, and by whom" required>
          <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} required minLength={3} />
        </Field>
        <Field label="After photos" hint="Optional, up to 2. Shown beside the original photo for the safety officer.">
          <PhotoPicker photos={photos} onChange={setPhotos} stamp={stamp} labels={["Add after photo", "Add 2nd after photo"]} />
        </Field>
        <div className="grid-2">
          <Field label="Action completed on">
            <input type="date" className="input" value={completedOn} max={todayLocal()} onChange={(e) => setCompletedOn(e.target.value)} />
          </Field>
          <Field label="Control level applied">
            <Select value={control} onChange={setControl} options={["Eliminate", "Substitute", "Engineering", "Administrative", "PPE"].map((v) => ({ value: v, label: v }))} placeholder="Same as planned" />
          </Field>
        </div>
        <p className="small muted">The safety officer approves it before it counts as closed.</p>
        <button className="btn btn-primary btn-block" disabled={busy || comment.trim().length < 3}>
          {busy ? "Submitting…" : "Submit closure"}
        </button>
      </form>
    </Sheet>
  );
}

function AssignSheet({ api, o, busy, onClose, onSave }: { api: Api; o: ObsDetail; busy: boolean; onClose: () => void; onSave: (ownerId: string | null) => void }) {
  const { data } = useLoad<{ sites: Site[] }>(() => api.get("/api/sites"), []);
  const site = data?.sites.find((s) => s.id === o.site.id);
  const [owner, setOwner] = useState(o.owner?.id ?? "");
  return (
    <Sheet title="Assign action owner" onClose={onClose}>
      {!data ? (
        <Spinner />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(owner || null);
          }}
        >
          <Field label="Action owner" hint="Supervisors and safety officers of this site.">
            <Select
              value={owner}
              onChange={setOwner}
              options={(site?.owners ?? []).map((p) => ({ value: p.id, label: `${p.name} – ${p.designation || p.role}${p.contractor ? ` (${p.contractor})` : ""}` }))}
              placeholder="Not assigned"
            />
          </Field>
          <button className="btn btn-primary btn-block" disabled={busy}>
            Save
          </button>
        </form>
      )}
    </Sheet>
  );
}

function ExtendSheet({ o, busy, onClose, onSave }: { o: ObsDetail; busy: boolean; onClose: () => void; onSave: (dueAt: string, reason: string) => void }) {
  const cur = o.dueAt ? new Date(o.dueAt) : new Date();
  const [date, setDate] = useState(new Date(cur.getTime() + 3 * 86_400_000).toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  return (
    <Sheet title="Extend due date" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(new Date(`${date}T18:00:00+05:30`).toISOString(), reason);
        }}
      >
        <p className="small muted">Current due date: {fmtDateTime(o.dueAt)}. The original date stays on record.</p>
        <Field label="New due date" required>
          <input type="date" className="input" value={date} min={todayLocal()} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Reason" required>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || reason.trim().length < 3}>
          Extend due date
        </button>
      </form>
    </Sheet>
  );
}

function ReasonSheet({ title, hint, action, danger, busy, onClose, onSave }: { title: string; hint: string; action: string; danger?: boolean; busy: boolean; onClose: () => void; onSave: (r: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(reason);
        }}
      >
        <p className="small muted">{hint}</p>
        <Field label="Reason" required>
          <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </Field>
        <button className={`btn btn-block ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy || reason.trim().length < 3}>
          {action}
        </button>
      </form>
    </Sheet>
  );
}

function EditSheet({ api, o, busy, onClose, onSave }: { api: Api; o: ObsDetail; busy: boolean; onClose: () => void; onSave: (body: object) => void }) {
  const { data: master } = useLoad<Master>(() => api.get("/api/master"), []);
  const { data: sites } = useLoad<{ sites: Site[] }>(() => api.get("/api/sites"), []);
  const site = sites?.sites.find((s) => s.id === o.site.id);
  const [f, setF] = useState({
    areaId: o.areaId ?? "",
    location: o.location,
    hazard: o.hazard,
    activity: o.activity,
    description: o.description,
    correctiveAction: o.correctiveAction,
    rootCause: o.rootCause,
    controlLevel: o.controlLevel,
    legalRef: o.legalRef,
    contractorId: o.contractorId ?? "",
    severity: o.severity,
    likelihood: o.likelihood,
    workStopped: o.workStopped,
    reason: "",
  });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const opts = useMemo(() => (list: string) => (master?.lists[list] ?? []).map((m) => ({ value: m.label, label: m.label })), [master]);
  if (!master || !sites) return <Sheet title="Edit observation" onClose={onClose}><Spinner /></Sheet>;
  return (
    <Sheet title="Edit observation" onClose={onClose} wide>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const body: any = { ...f, areaId: f.areaId || null, contractorId: f.contractorId || null };
          if (o.type === "safe_behaviour") {
            delete body.severity;
            delete body.likelihood;
          }
          onSave(body);
        }}
      >
        <p className="small muted">Every save is kept as a new version with who, when and what changed.</p>
        <div className="grid-2">
          <Field label="Area">
            <Select value={f.areaId} onChange={(v) => set("areaId", v)} options={(site?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))} placeholder="Not set" />
          </Field>
          <Field label="Exact location">
            <input className="input" value={f.location} onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field label="Hazard type">
            <Select value={f.hazard} onChange={(v) => set("hazard", v)} options={opts("hazard")} />
          </Field>
          <Field label="Contractor">
            <Select value={f.contractorId} onChange={(v) => set("contractorId", v)} options={(site?.contractors ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="None" />
          </Field>
        </div>
        <Field label="Work activity">
          <Select value={f.activity} onChange={(v) => set("activity", v)} options={opts("activity")} />
        </Field>
        <Field label="What was observed">
          <textarea className="textarea" value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        {o.type !== "safe_behaviour" && (
          <>
            <Field label="Risk">
              <RiskMatrix severity={f.severity} likelihood={f.likelihood} workStopped={f.workStopped} onChange={(s, l) => setF((x) => ({ ...x, severity: s, likelihood: l }))} />
            </Field>
            <label className="checkline">
              <input type="checkbox" checked={f.workStopped} onChange={(e) => set("workStopped", e.target.checked)} />
              <span>Imminent danger – work stopped</span>
            </label>
            <Field label="Corrective / preventive action">
              <textarea className="textarea" value={f.correctiveAction} onChange={(e) => set("correctiveAction", e.target.value)} />
            </Field>
            <div className="grid-2">
              <Field label="Likely root cause">
                <Select value={f.rootCause} onChange={(v) => set("rootCause", v)} options={opts("root_cause")} />
              </Field>
              <Field label="Control level">
                <Select value={f.controlLevel} onChange={(v) => set("controlLevel", v)} options={opts("control_level")} />
              </Field>
            </div>
          </>
        )}
        <Field label="Legal / standard reference">
          <input className="input" value={f.legalRef} onChange={(e) => set("legalRef", e.target.value)} />
        </Field>
        <Field label="Reason for the change">
          <input className="input" value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Optional" />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>
          Save changes
        </button>
      </form>
    </Sheet>
  );
}
