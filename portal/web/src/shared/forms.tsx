import { ReactNode, useId, useRef } from "react";
import { compressPhoto } from "./image";
import { LIKELIHOOD, riskLevelOf, SEVERITY } from "./format";
import { IconCamera, IconX } from "./icons";
import { Risk, useToast } from "./ui";

export function Field({ label, hint, required, children, htmlFor }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label} {required && <span className="req" aria-label="required">*</span>}
      </label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export interface PickedPhoto {
  blob: Blob;
  url: string;
}

export function PhotoPicker({
  photos,
  onChange,
  max = 2,
  stamp,
  required,
  labels = ["Add photo", "Add 2nd photo (optional)"],
}: {
  photos: PickedPhoto[];
  onChange: (p: PickedPhoto[]) => void;
  max?: number;
  stamp: string;
  required?: boolean;
  labels?: string[];
}) {
  const input = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const id = useId();
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = max - photos.length;
    const next = [...photos];
    for (const f of Array.from(files).slice(0, room)) {
      if (!f.type.startsWith("image/")) {
        toast("Choose a photo (JPEG or PNG).", true);
        continue;
      }
      try {
        const blob = await compressPhoto(f, stamp);
        next.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        toast("That photo could not be read. Try another.", true);
      }
    }
    if (files.length > room) toast(`Only ${max} photos per point.`, true);
    onChange(next);
    if (input.current) input.current.value = "";
    if (gallery.current) gallery.current.value = "";
  }
  return (
    <div>
      {/* Tapping a slot opens the camera on phones; the link below opens the gallery. */}
      <input id={id} ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
      <input ref={gallery} type="file" accept="image/*" multiple={max - photos.length > 1} hidden onChange={(e) => onFiles(e.target.files)} />
      <div className="photo-slots">
        {Array.from({ length: max }).map((_, i) => {
          const p = photos[i];
          if (p)
            return (
              <div className="photo-slot filled" key={i}>
                <img src={p.url} alt={`Photo ${i + 1}`} />
                <button
                  type="button"
                  className="remove"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => {
                    URL.revokeObjectURL(p.url);
                    onChange(photos.filter((_, j) => j !== i));
                  }}
                >
                  <IconX size={18} />
                </button>
              </div>
            );
          const enabled = i === photos.length;
          return (
            <button
              type="button"
              key={i}
              className={`photo-slot ${required && i === 0 ? "required" : ""}`}
              disabled={!enabled}
              onClick={() => input.current?.click()}
              style={!enabled ? { opacity: 0.45, cursor: "default" } : undefined}
            >
              <span className="stack" style={{ alignItems: "center", gap: 6 }}>
                <IconCamera size={30} />
                <span style={{ fontWeight: 600 }}>{labels[i] ?? "Add photo"}</span>
              </span>
            </button>
          );
        })}
      </div>
      {photos.length < max && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6, paddingLeft: 0 }} onClick={() => gallery.current?.click()}>
          Choose from gallery instead
        </button>
      )}
    </div>
  );
}

export function RiskMatrix({
  severity,
  likelihood,
  workStopped,
  onChange,
}: {
  severity: number | null;
  likelihood: number | null;
  workStopped: boolean;
  onChange: (s: number, l: number) => void;
}) {
  const level = riskLevelOf(severity, likelihood, workStopped);
  return (
    <div>
      <div className="matrix" role="grid" aria-label="Risk matrix: severity by likelihood">
        <span />
        {LIKELIHOOD.map((l, i) => (
          <span className="ax" key={l} title={l}>
            {i + 1}
            <br />
            {l}
          </span>
        ))}
        {[5, 4, 3, 2, 1].map((s) => (
          <div style={{ display: "contents" }} key={s} role="row">
            <span className="ax ax-row" title={SEVERITY[s - 1]}>
              {s} · {SEVERITY[s - 1]}
            </span>
            {[1, 2, 3, 4, 5].map((l) => {
              const lv = riskLevelOf(s, l, false)!;
              const on = severity === s && likelihood === l;
              return (
                <button
                  type="button"
                  key={l}
                  className={`m-${lv}`}
                  aria-pressed={on}
                  aria-label={`Severity ${s} ${SEVERITY[s - 1]}, likelihood ${l} ${LIKELIHOOD[l - 1]}: ${lv}, score ${s * l}`}
                  onClick={() => onChange(s, l)}
                >
                  {s * l}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="matrix-result" aria-live="polite">
        {level ? (
          <>
            <Risk level={level} />
            <span className="small">
              {severity && likelihood ? `Severity ${severity} × likelihood ${likelihood} = ${severity * likelihood}` : ""}
              {workStopped ? " · work stopped makes it Critical" : ""}
            </span>
          </>
        ) : (
          <span className="small muted">Tap the cell that matches how bad it could be (row) and how likely it is (column).</span>
        )}
      </div>
    </div>
  );
}

export function Select({
  id,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  required,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="chips" role="group">
      {options.map((o) => (
        <button type="button" key={o} className="chip" aria-pressed={value === o} onClick={() => onChange(value === o ? "" : o)}>
          {o}
        </button>
      ))}
    </div>
  );
}
