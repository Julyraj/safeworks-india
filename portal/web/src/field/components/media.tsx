/* Photos, voice and signatures on the phone. Photos are compressed and hashed the moment they are picked (shared/image.ts);
   the blur editor burns pixelated boxes into the evidence file and re-hashes it; removing a photo is undoable. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaRef } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Sheet, Thumb, Lightbox, useToast } from "../../shared/ui";
import { IconCamera, IconMic, IconX, IconEyeOff, IconPlus, IconTrash } from "../../shared/icons";
import { preparePhoto, type BlurBox, voiceNote } from "../../shared/image";
import { uuid } from "../../shared/storage";

export interface PhotoDraft {
  id: string;
  original: Blob; // the capture before blur, kept so blur boxes can be edited
  blob: Blob; // what will be uploaded (blurred when boxes exist)
  ref: MediaRef;
  blur: BlurBox[];
}
export function photoBytes(p: PhotoDraft): { ref: MediaRef; blob: Blob } { return { ref: p.ref, blob: p.blob }; }

/** Object URLs for a list of blobs, revoked when they change or the component unmounts. */
export function useObjectUrls(blobs: (Blob | null | undefined)[], keys: string[]): Record<string, string> {
  const sig = keys.join("|");
  const urls = useMemo(() => {
    const out: Record<string, string> = {};
    blobs.forEach((b, i) => { if (b) out[keys[i]] = URL.createObjectURL(b); });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => () => { for (const u of Object.values(urls)) URL.revokeObjectURL(u); }, [urls]);
  return urls;
}

export function PhotoStrip({ photos, onChange, max, purpose, geo, big, label, required }: {
  photos: PhotoDraft[]; onChange: (next: PhotoDraft[]) => void; max: number; purpose: MediaRef["purpose"];
  geo?: { lat: number | null; lng: number | null }; big?: boolean; label?: string; required?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PhotoDraft | null>(null);
  const [view, setView] = useState<string | null>(null);
  const urls = useObjectUrls(photos.map((p) => p.blob), photos.map((p) => p.id + ":" + p.ref.sha256));

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const next = [...photos];
      for (const f of Array.from(files)) {
        if (next.length >= max) { toast.show(t("photo.maxReached", { max })); break; }
        if (!f.type.startsWith("image/")) { toast.error(t("photo.notImage")); continue; }
        try {
          const p = await preparePhoto(f, { purpose, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
          URL.revokeObjectURL(p.previewUrl);
          next.push({ id: uuid(), original: f, blob: p.blob, ref: p.ref, blur: [] });
        } catch (e) {
          toast.error(e instanceof Error && e.message === "photo_too_large" ? t("photo.tooLarge") : t("photo.failed"));
        }
      }
      onChange(next);
    } finally {
      setBusy(false);
      if (camRef.current) camRef.current.value = "";
      if (galRef.current) galRef.current.value = "";
    }
  }, [photos, max, purpose, geo?.lat, geo?.lng, onChange, t, toast]);

  const remove = (p: PhotoDraft) => {
    const idx = photos.indexOf(p);
    onChange(photos.filter((x) => x.id !== p.id));
    toast.undoable(t("photo.removed"), () => { /* nothing to commit: the blob is already out of the draft */ }, () => {
      const restored = [...photos.filter((x) => x.id !== p.id)];
      restored.splice(Math.min(idx, restored.length), 0, p);
      onChange(restored);
    });
  };

  const applyBlur = async (p: PhotoDraft, boxes: BlurBox[]) => {
    setBusy(true);
    try {
      const prepared = await preparePhoto(p.original, { purpose, lat: geo?.lat ?? null, lng: geo?.lng ?? null, blur: boxes, capturedAt: p.ref.capturedAt });
      URL.revokeObjectURL(prepared.previewUrl);
      onChange(photos.map((x) => (x.id === p.id ? { ...x, blob: prepared.blob, blur: boxes, ref: { ...prepared.ref, clientUuid: p.ref.clientUuid } } : x)));
      setEditing(null);
      if (boxes.length) toast.success(t("photo.blurApplied", { count: boxes.length }));
    } catch {
      toast.error(t("photo.failed"));
    } finally { setBusy(false); }
  };

  const canAdd = photos.length < max;
  return (
    <div>
      {label ? <div className="label" style={{ marginBottom: 6 }}>{label}{required ? <span className="req" aria-hidden>*</span> : null} <span className="muted small">({photos.length}/{max})</span></div> : null}
      <div className="photo-strip">
        {canAdd ? (
          <button type="button" className={`add${big && photos.length === 0 ? " big" : ""}`} onClick={() => camRef.current?.click()} disabled={busy} aria-label={t("common.takePhoto")}>
            <span className="stack" style={{ alignItems: "center", gap: 4 }}>
              <IconCamera size={big && photos.length === 0 ? 34 : 26} />
              <span className="small" style={{ fontWeight: 600 }}>{busy ? t("common.loading") : t("common.takePhoto")}</span>
            </span>
          </button>
        ) : null}
        {photos.map((p) => (
          <Thumb key={p.id} src={urls[p.id + ":" + p.ref.sha256]} alt={t("common.photo")} onClick={() => setEditing(p)} onRemove={() => remove(p)} tag={p.blur.length ? t("photo.blurred") : undefined} />
        ))}
        {canAdd && photos.length > 0 ? (
          <button type="button" className="add" style={{ width: 64 }} onClick={() => galRef.current?.click()} disabled={busy} aria-label={t("photo.fromGallery")}><IconPlus /></button>
        ) : null}
      </div>
      {canAdd && photos.length === 0 ? <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => galRef.current?.click()}>{t("photo.fromGallery")}</button> : null}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addFiles(e.target.files)} data-testid="photo-input" />
      <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles(e.target.files)} data-testid="gallery-input" />
      {editing ? <BlurEditor photo={editing} url={urls[editing.id + ":" + editing.ref.sha256]} busy={busy} onClose={() => setEditing(null)} onApply={(b) => void applyBlur(editing, b)} onView={() => { setView(urls[editing.id + ":" + editing.ref.sha256]); }} /> : null}
      {view ? <Lightbox src={view} onClose={() => setView(null)} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- blur editor (boxes only; arrows are Phase 2) */
function BlurEditor({ photo, url, busy, onClose, onApply, onView }: { photo: PhotoDraft; url: string; busy: boolean; onClose: () => void; onApply: (boxes: BlurBox[]) => void; onView: () => void }) {
  const { t } = useI18n();
  const [boxes, setBoxes] = useState<BlurBox[]>(photo.blur);
  const [drag, setDrag] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const originalUrl = useMemo(() => URL.createObjectURL(photo.original), [photo.original]);
  useEffect(() => () => URL.revokeObjectURL(originalUrl), [originalUrl]);
  const frac = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const live = drag ? { x: Math.min(drag.x, drag.cx), y: Math.min(drag.y, drag.cy), w: Math.abs(drag.cx - drag.x), h: Math.abs(drag.cy - drag.y) } : null;
  return (
    <Sheet title={t("photo.markup")} onClose={onClose} wide footer={
      <>
        <Button onClick={onView}>{t("common.view")}</Button>
        <Button variant="primary" loading={busy} onClick={() => onApply(boxes)}>{boxes.length ? t("photo.applyBlur", { count: boxes.length }) : t("common.done")}</Button>
      </>
    }>
      <p className="small muted">{t("photo.markupHint")}</p>
      <div className="blur-editor" ref={ref}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); const p = frac(e); setDrag({ x: p.x, y: p.y, cx: p.x, cy: p.y }); }}
        onPointerMove={(e) => { if (drag) { const p = frac(e); setDrag({ ...drag, cx: p.x, cy: p.y }); } }}
        onPointerUp={() => { if (live && live.w > 0.02 && live.h > 0.02) setBoxes([...boxes, live]); setDrag(null); }}
        onPointerCancel={() => setDrag(null)}>
        <img src={boxes.length ? originalUrl : url} alt="" draggable={false} />
        {boxes.map((b, i) => (
          <div key={i} className="box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
            <button type="button" className="rm" aria-label={t("common.remove")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setBoxes(boxes.filter((_, j) => j !== i)); }}><IconX size={14} /></button>
          </div>
        ))}
        {live ? <div className="box" style={{ left: `${live.x * 100}%`, top: `${live.y * 100}%`, width: `${live.w * 100}%`, height: `${live.h * 100}%` }} /> : null}
      </div>
      <div className="row between" style={{ marginTop: 8 }}>
        <span className="small muted"><IconEyeOff size={14} /> {t("photo.boxes", { count: boxes.length })}</span>
        {boxes.length ? <Button size="sm" variant="ghost" onClick={() => setBoxes([])}><IconTrash size={14} /> {t("photo.clearBoxes")}</Button> : null}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- voice note (≤ 60 s, MediaRecorder) */
export interface VoiceDraft { blob: Blob; ref: MediaRef; durationS: number }
export const VOICE_MAX_S = 60;
export function VoiceNoteButton({ value, onChange }: { value: VoiceDraft | null; onChange: (v: VoiceDraft | null) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const supported = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
  const url = useMemo(() => (value ? URL.createObjectURL(value.blob) : null), [value]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => {
      const s = Math.round((Date.now() - startedAt.current) / 1000);
      setSecs(s);
      if (s >= VOICE_MAX_S && rec.state === "recording") rec.stop();
    }, 250);
    return () => clearInterval(id);
  }, [rec]);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const dur = Math.min(VOICE_MAX_S, Math.round((Date.now() - startedAt.current) / 1000));
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (blob.size > 0) onChange({ ...(await voiceNote(blob, dur)), durationS: dur });
        setRec(null);
        setSecs(0);
      };
      startedAt.current = Date.now();
      r.start(500);
      setRec(r);
    } catch {
      toast.error(t("voice.denied"));
    }
  };
  if (!supported) return null;
  if (value && url) {
    return (
      <div className="voice">
        <IconMic size={18} />
        <audio controls src={url} preload="metadata" />
        <span className="small muted">{value.durationS}s</span>
        <Button size="sm" variant="ghost" icon aria-label={t("common.remove")} onClick={() => { const v = value; onChange(null); toast.undoable(t("voice.removed"), () => { /* already removed from the draft */ }, () => onChange(v)); }}><IconX size={16} /></Button>
      </div>
    );
  }
  return (
    <button type="button" className={`mic-btn${rec ? " rec" : ""}`} onClick={() => (rec ? rec.stop() : void start())} aria-label={rec ? t("voice.stop") : t("voice.record")} aria-pressed={!!rec} title={t("voice.hint", { max: VOICE_MAX_S })}>
      {rec ? <span className="small" style={{ fontWeight: 700 }}>{VOICE_MAX_S - secs}</span> : <IconMic />}
    </button>
  );
}

/* ---------------------------------------------------------------- signature pad */
export function SignaturePad({ onChange, label }: { onChange: (canvas: HTMLCanvasElement | null) => void; label?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [has, setHas] = useState(false);
  useEffect(() => {
    const c = ref.current!;
    const resize = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const data = has ? c.toDataURL() : null;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = getComputedStyle(c).color || "#0f1c2b";
      if (data) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = data; }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  return (
    <div>
      {label ? <div className="label" style={{ marginBottom: 6 }}>{label}</div> : null}
      <canvas ref={ref} className="sig-pad" style={{ color: "var(--ink)" }} aria-label={t("run.signHere")}
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke(); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }}
        onPointerUp={() => { drawing.current = false; setHas(true); onChange(ref.current); }}
        onPointerCancel={() => { drawing.current = false; }} />
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="small muted">{has ? t("run.signed") : t("run.signHere")}</span>
        <Button size="sm" variant="ghost" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setHas(false); onChange(null); }} disabled={!has}>{t("run.clearSignature")}</Button>
      </div>
    </div>
  );
}
