import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, uuid } from "../../shared/api";
import { Chips, Field, PhotoPicker, PickedPhoto, RiskMatrix, Select } from "../../shared/forms";
import { fmtDate, riskLevelOf, todayLocal, TYPE_LABEL } from "../../shared/format";
import { stampText } from "../../shared/image";
import type { ObsDetail, ObsType } from "../../shared/types";
import { Empty, Risk, useLoad, useToast } from "../../shared/ui";
import { enqueue, toForm } from "../outbox";
import { api, useSession } from "../session";

const TYPES: { t: ObsType; hint: string }[] = [
  { t: "unsafe_act", hint: "What a person did" },
  { t: "unsafe_condition", hint: "What is wrong on site" },
  { t: "near_miss", hint: "Nearly caused harm" },
  { t: "safe_behaviour", hint: "Good practice seen" },
];

const blank = {
  type: "" as ObsType | "",
  categoryCode: "",
  itemCode: "",
  itemOther: "",
  hazard: "",
  activity: "",
  lsr: "",
  permitType: "",
  permitNo: "",
  equipment: "",
  personObserved: "",
  contractorId: "",
  crewSize: "",
  severity: null as number | null,
  likelihood: null as number | null,
  workStopped: false,
  description: "",
  immediateAction: "",
  rootCause: "",
  correctiveAction: "",
  controlLevel: "",
  correctedOnSpot: false,
  ownerId: "",
  dueDate: "",
  legalRef: "",
};

export function Raise() {
  const s = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const roundId = params.get("round");
  const round = useLoad<{ id: string; code: string; status: string; site: { id: string }; points: unknown[] } | null>(
    () => (roundId ? api.get(`/api/rounds/${roundId}`) : Promise.resolve(null)),
    [roundId],
  );
  const raiseSites = s.sites.filter((x) => x.can.raise);
  const [siteId, setSiteId] = useState<string>(() => (s.site?.can.raise ? s.site.id : raiseSites[0]?.id) ?? "");
  const site = raiseSites.find((x) => x.id === siteId) ?? null;
  const [areaId, setAreaId] = useState("");
  const [location, setLocation] = useState("");
  const [f, setF] = useState({ ...blank });
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [after, setAfter] = useState<PickedPhoto[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [lastSaved, setLastSaved] = useState<{ id: string; code: string } | null>(null);
  const [count, setCount] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const observedAt = useRef(new Date().toISOString());

  useEffect(() => {
    if (round.data?.site?.id) setSiteId(round.data.site.id);
  }, [round.data?.site?.id]);

  const L = s.master.lists;
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }));
  const isSafe = f.type === "safe_behaviour";
  const needsCategory = f.type === "unsafe_act" || f.type === "unsafe_condition";
  const needsAction = !!f.type && !isSafe && !f.correctedOnSpot;
  const level = isSafe ? null : riskLevelOf(f.severity, f.likelihood, f.workStopped);
  const autoDue = useMemo(() => {
    if (!level) return "";
    const days = s.master.settings.dueDays[level] ?? 7;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86_400_000));
  }, [level, s.master.settings.dueDays]);

  const categories = (L.category ?? []).filter((c) => c.parent === f.type);
  const items = (L.item ?? []).filter((i) => i.parent === f.categoryCode);
  const opts = (list: string) => (L[list] ?? []).map((m) => ({ value: m.label, label: m.label }));

  if (!raiseSites.length) {
    return (
      <div className="section">
        <Empty title="Only safety officers raise points">
          <p>Your login can close points assigned to you. Report hazards to your site safety officer.</p>
          <Link to="/" className="btn">
            Back to home
          </Link>
        </Empty>
      </div>
    );
  }

  function validate(): string[] {
    const e: string[] = [];
    if (!site) e.push("Choose the site.");
    if (photos.length < 1) e.push("Add at least 1 photo (maximum 2).");
    if (!f.type) e.push("Choose the observation type.");
    if (needsCategory && !f.categoryCode) e.push("Choose a category.");
    if (needsCategory && !f.itemCode) e.push("Choose the specific observation.");
    if (f.itemCode === "other" && !f.itemOther.trim()) e.push("Describe the observation for 'Other'.");
    if (f.type === "unsafe_act" && !f.personObserved.trim()) e.push("Person observed is required for unsafe acts (trade/role and employer, no names).");
    if (f.type && !isSafe) {
      if (!f.hazard) e.push("Choose the hazard type.");
      if (!f.severity || !f.likelihood) e.push("Tap the risk matrix to set severity and likelihood.");
      if (!f.immediateAction) e.push("Choose the immediate action taken.");
      if (!f.rootCause) e.push("Choose the likely root cause.");
    }
    if (f.description.trim().length < 3) e.push("Describe what was observed.");
    if (needsAction && !f.correctiveAction.trim()) e.push("Describe the corrective / preventive action.");
    return e;
  }

  async function save(e: FormEvent, next: boolean) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (errs.length) {
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const id = uuid();
    const payload: Record<string, unknown> = {
      id,
      siteId,
      roundId: roundId || null,
      areaId: areaId || null,
      location,
      observedAt: observedAt.current,
      type: f.type,
      categoryCode: f.categoryCode,
      itemCode: f.itemCode,
      itemOther: f.itemOther,
      hazard: isSafe ? f.hazard : f.hazard,
      activity: f.activity,
      lsr: f.lsr,
      permitType: f.permitType,
      permitNo: f.permitNo,
      equipment: f.equipment,
      personObserved: f.personObserved,
      contractorId: f.contractorId || null,
      crewSize: f.crewSize ? Number(f.crewSize) : null,
      severity: isSafe ? null : f.severity,
      likelihood: isSafe ? null : f.likelihood,
      workStopped: f.workStopped,
      description: f.description,
      immediateAction: f.immediateAction,
      rootCause: isSafe ? "" : f.rootCause,
      correctiveAction: f.correctiveAction,
      controlLevel: f.controlLevel,
      correctedOnSpot: f.correctedOnSpot,
      ownerId: needsAction && f.ownerId ? f.ownerId : null,
      dueAt: needsAction && f.dueDate && f.dueDate !== autoDue ? new Date(`${f.dueDate}T18:00:00+05:30`).toISOString() : null,
      legalRef: f.legalRef,
    };
    const pos = await quickPosition();
    if (pos) Object.assign(payload, pos);
    const blobs = photos.map((p) => p.blob);
    const afterBlobs = f.correctedOnSpot ? after.map((p) => p.blob) : [];
    setBusy(true);
    let saved: { id: string; code: string } | null = null;
    try {
      const o = await api.upload<ObsDetail>("/api/observations", toForm(payload, blobs, afterBlobs));
      saved = { id: o.id, code: o.code };
      toast(`${o.code} saved${o.owner ? ` and assigned to ${o.owner.name}` : ""}`);
    } catch (err) {
      const ae = err as ApiError;
      if (ae.status === 0) {
        await enqueue({ id, data: payload, photos: blobs, after: afterBlobs, label: `${TYPE_LABEL[f.type as ObsType]}: ${f.description.slice(0, 60)}` });
        saved = { id, code: "Saved on this phone" };
        toast("No connection. The point is saved on this phone and will upload automatically.");
      } else {
        toast(ae.message, true);
        setErrors([ae.message]);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setLastSaved(saved);
    setCount((c) => c + 1);
    if (next) {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      after.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setAfter([]);
      setF((x) => ({ ...blank, activity: x.activity, type: x.type, contractorId: "" }));
      setLocation("");
      setErrors([]);
      observedAt.current = new Date().toISOString();
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (roundId) nav(`/walks/${roundId}`);
    else if (saved && saved.code !== "Saved on this phone") nav(`/o/${saved.id}`, { replace: true });
    else nav("/");
  }

  return (
    <form className="stack-lg" onSubmit={(e) => save(e, false)} noValidate>
      <div ref={top} className="page-head" style={{ scrollMarginTop: 70 }}>
        <div>
          <h1>Raise observation</h1>
          <p>
            {round.data ? (
              <>
                Safety walk <span className="code">{round.data.code}</span> · {(round.data.points?.length ?? 0) + count} point{(round.data.points?.length ?? 0) + count === 1 ? "" : "s"}
              </>
            ) : (
              "Photo first, then a few taps. About a minute per point."
            )}
          </p>
        </div>
        {roundId && (
          <Link className="btn" to={`/walks/${roundId}`}>
            Back to walk
          </Link>
        )}
      </div>

      {lastSaved && (
        <div className="alert ok" role="status">
          Saved{lastSaved.code !== "Saved on this phone" ? (
            <>
              {" "}
              <Link to={`/o/${lastSaved.id}`} className="code">
                {lastSaved.code}
              </Link>
            </>
          ) : (
            " on this phone (offline)"
          )}
          . {count} point{count === 1 ? "" : "s"} this session.
        </div>
      )}
      {errors.length > 0 && (
        <div className="alert err" role="alert">
          <strong>Check these before saving:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="section stack">
        {raiseSites.length > 1 && !roundId && (
          <Field label="Site" required>
            <Select value={siteId} onChange={(v) => { setSiteId(v); setAreaId(""); set("ownerId", ""); set("contractorId", ""); }} options={raiseSites.map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
        )}
        <Field label="Photos" required hint="At least 1, at most 2. Each photo is stamped with date, time, site and your name.">
          <PhotoPicker photos={photos} onChange={setPhotos} stamp={stampText(site?.name ?? "", s.me.name)} required />
        </Field>
        <div className="grid-2">
          <Field label="Area / zone">
            <Select value={areaId} onChange={setAreaId} options={(site?.areas ?? []).map((a) => ({ value: a.id, label: a.name }))} placeholder="Choose area" />
          </Field>
          <Field label="Exact location">
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Grid C-4, near lift shaft" />
          </Field>
        </div>
      </section>

      <section className="section stack">
        <Field label="Observation type" required>
          <div className="seg" role="group" aria-label="Observation type">
            {TYPES.map(({ t, hint }) => (
              <button type="button" key={t} aria-pressed={f.type === t} onClick={() => setF((x) => ({ ...x, type: t, categoryCode: "", itemCode: "", itemOther: "" }))}>
                {TYPE_LABEL[t]}
                <small>{hint}</small>
              </button>
            ))}
          </div>
        </Field>
        {needsCategory && (
          <div className="grid-2">
            <Field label="Category" required>
              <Select value={f.categoryCode} onChange={(v) => setF((x) => ({ ...x, categoryCode: v, itemCode: "" }))} options={categories.map((c) => ({ value: c.code, label: c.label }))} />
            </Field>
            <Field label="Specific observation" required>
              <Select
                value={f.itemCode}
                onChange={(v) => set("itemCode", v)}
                options={[...items.map((i) => ({ value: i.code, label: i.label })), ...(f.categoryCode ? [{ value: "other", label: "Other (describe)" }] : [])]}
                placeholder={f.categoryCode ? "Choose…" : "Choose a category first"}
              />
            </Field>
          </div>
        )}
        {f.itemCode === "other" && (
          <Field label="Describe the observation" required>
            <input className="input" value={f.itemOther} onChange={(e) => set("itemOther", e.target.value)} />
          </Field>
        )}
        <div className="grid-2">
          <Field label="Hazard type" required={!isSafe}>
            <Select value={f.hazard} onChange={(v) => set("hazard", v)} options={opts("hazard")} />
          </Field>
          <Field label="Work activity">
            <Select value={f.activity} onChange={(v) => set("activity", v)} options={opts("activity")} />
          </Field>
        </div>
        {f.type === "unsafe_act" && (
          <Field label="Person observed" required hint="Trade / role and employer only — no names (no-blame).">
            <input className="input" value={f.personObserved} onChange={(e) => set("personObserved", e.target.value)} placeholder="e.g. Rigger – XYZ Scaffolding" />
          </Field>
        )}
        <div className="grid-2">
          <Field label="Contractor responsible">
            <Select value={f.contractorId} onChange={(v) => set("contractorId", v)} options={(site?.contractors ?? []).map((c) => ({ value: c.id, label: c.name }))} placeholder="None / own staff" />
          </Field>
          <Field label="Life-Saving Rule breached">
            <Select value={f.lsr} onChange={(v) => set("lsr", v)} options={opts("lsr")} placeholder="None" />
          </Field>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? "Hide permit, equipment and crew details" : "Add permit, equipment or crew details"}
        </button>
        {more && (
          <div className="grid-2">
            <Field label="Permit-to-work type">
              <Select value={f.permitType} onChange={(v) => set("permitType", v)} options={opts("permit_type")} placeholder="None" />
            </Field>
            <Field label="Permit number">
              <input className="input" value={f.permitNo} onChange={(e) => set("permitNo", e.target.value)} />
            </Field>
            <Field label="Equipment / asset">
              <input className="input" value={f.equipment} onChange={(e) => set("equipment", e.target.value)} placeholder="Crane no., scaffold tag, vehicle no." />
            </Field>
            <Field label="Crew size involved">
              <input className="input" inputMode="numeric" value={f.crewSize} onChange={(e) => set("crewSize", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Legal / standard reference">
              <input className="input" value={f.legalRef} onChange={(e) => set("legalRef", e.target.value)} placeholder={site?.state === "Tamil Nadu" ? "e.g. TN Factories Rules 1950, Rule 61-B" : "e.g. Karnataka Factories Rules 1969"} />
            </Field>
          </div>
        )}
      </section>

      {f.type && !isSafe && (
        <section className="section stack">
          <h3>Risk</h3>
          <RiskMatrix severity={f.severity} likelihood={f.likelihood} workStopped={f.workStopped} onChange={(sv, lk) => setF((x) => ({ ...x, severity: sv, likelihood: lk }))} />
          <label className="checkline">
            <input type="checkbox" checked={f.workStopped} onChange={(e) => set("workStopped", e.target.checked)} />
            <span>
              <strong>Imminent danger – work stopped</strong>
              <br />
              <span className="small muted">Stop Work Authority used. Makes the point Critical.</span>
            </span>
          </label>
        </section>
      )}

      <section className="section stack">
        <Field label="What was observed" required hint="Use the microphone on your keyboard to dictate.">
          <textarea className="textarea" value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        {f.type && (
          <Field label="Immediate action taken" required={!isSafe}>
            <Chips options={opts("immediate_action").map((o) => o.label)} value={f.immediateAction} onChange={(v) => set("immediateAction", v)} />
          </Field>
        )}
        {f.type && !isSafe && (
          <Field label="Likely root cause" required>
            <Select value={f.rootCause} onChange={(v) => set("rootCause", v)} options={opts("root_cause")} />
          </Field>
        )}
      </section>

      {f.type && !isSafe && (
        <section className="section stack">
          <h3>Action</h3>
          <label className="checkline">
            <input type="checkbox" checked={f.correctedOnSpot} onChange={(e) => set("correctedOnSpot", e.target.checked)} />
            <span>
              <strong>Corrected on the spot</strong>
              <br />
              <span className="small muted">Raise and close in one step. Add an after-photo if you can.</span>
            </span>
          </label>
          {f.correctedOnSpot && (
            <Field label="After photos" hint="Optional, up to 2.">
              <PhotoPicker photos={after} onChange={setAfter} stamp={stampText(site?.name ?? "", s.me.name)} labels={["Add after photo", "Add 2nd after photo"]} />
            </Field>
          )}
          <Field label="Corrective / preventive action" required={!f.correctedOnSpot}>
            <textarea className="textarea" value={f.correctiveAction} onChange={(e) => set("correctiveAction", e.target.value)} placeholder="What must be done to fix it and stop it happening again" />
          </Field>
          <Field label="Control level">
            <Chips options={opts("control_level").map((o) => o.label)} value={f.controlLevel} onChange={(v) => set("controlLevel", v)} />
          </Field>
          {!f.correctedOnSpot && (
            <div className="grid-2">
              <Field label="Action owner" hint="You can also assign later from the point.">
                <Select
                  value={f.ownerId}
                  onChange={(v) => set("ownerId", v)}
                  options={(site?.owners ?? []).map((p) => ({ value: p.id, label: `${p.name} – ${p.designation || p.role}${p.contractor ? ` (${p.contractor})` : ""}` }))}
                  placeholder="Assign later"
                />
              </Field>
              <Field label="Due date" hint={level ? <>Set from the risk level: <Risk level={level} /> {s.master.settings.dueDays[level]} day(s). You can change it.</> : "Set from the risk level once you tap the matrix."}>
                <input type="date" className="input" min={todayLocal()} value={f.dueDate || autoDue} onChange={(e) => set("dueDate", e.target.value)} disabled={!level} />
              </Field>
            </div>
          )}
        </section>
      )}

      <div className="actionbar">
        <button type="button" className="btn grow" disabled={busy} onClick={(e) => save(e as unknown as FormEvent, true)}>
          {busy ? "Saving…" : "Save & next point"}
        </button>
        <button className="btn btn-primary grow" disabled={busy}>
          {busy ? "Saving…" : roundId ? "Save & back to walk" : "Save"}
        </button>
      </div>
      <p className="small muted">
        Observed {fmtDate(observedAt.current)} by {s.me.name} ({s.me.employeeId}).
      </p>
    </form>
  );
}

async function quickPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = await (navigator as any).permissions?.query({ name: "geolocation" });
    if (!perm || perm.state !== "granted") return null;
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }),
        () => resolve(null),
        { timeout: 3000, maximumAge: 120_000 },
      );
    });
  } catch {
    return null;
  }
}
