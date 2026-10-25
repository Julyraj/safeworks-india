/* SafeWorks web kit — React components over the classes in ../base.css.
   Every app (field, QR form, admin) builds its screens from these so they look and behave the same:
   buttons, chips, pills, cards, sheets, toasts with Undo, skeletons, empty states, error boundary, fields,
   toggles, tabs, segmented control, progress, banners, risk matrix, photo strip, timeline, KPI tile, table,
   pagination, keyboard-shortcut help. Strings come from the i18n context; the kit has no English of its own
   except the fallback inside t(). */
import {
  Component, createContext, type ErrorInfo, type FormEvent, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type AnchorHTMLAttributes,
} from "react";
import type { Band, I18n, Media, RiskMatrixVersion } from "../types";
import { useI18n, type TFn } from "../i18n";
import { BAND_COLOUR } from "../format";
import { bandFor, cellColour } from "../risk";
import { copyText } from "../storage";
import { useHotkeys } from "../hooks";
import { IconAlert, IconBack, IconCheckCircle, IconInbox, IconKeyboard, IconRefresh, IconSearch, IconX } from "../icons";

/* ---------------------------------------------------------------- buttons */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "default" | "danger" | "ghost" | "subtle";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: boolean;
  loading?: boolean;
};
export function Button({ variant = "default", size = "md", block, icon, loading, className = "", children, disabled, ...p }: BtnProps) {
  const cls = ["btn", variant !== "default" ? variant : "", size !== "md" ? size : "", block ? "block" : "", icon ? "icon" : "", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading ? <span className="spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
export function LinkButton({ variant = "default", size = "md", block, className = "", children, ...p }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: BtnProps["variant"]; size?: BtnProps["size"]; block?: boolean }) {
  const cls = ["btn", variant !== "default" ? variant : "", size !== "md" ? size : "", block ? "block" : "", className].filter(Boolean).join(" ");
  return <a className={cls} {...p}>{children}</a>;
}
export function BackButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useI18n();
  return (
    <Button variant="ghost" icon onClick={onClick} aria-label={label ?? t("common.back")}>
      <IconBack />
    </Button>
  );
}

/* ---------------------------------------------------------------- chips, pills */
export function Chip({ on, children, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; size?: "lg" }) {
  return (
    <button type="button" className={`chip${size ? ` ${size}` : ""}`} aria-pressed={!!on} {...p}>
      {children}
    </button>
  );
}
export function ChipBar({ children, wrap }: { children: ReactNode; wrap?: boolean }) {
  return <div className={`chipbar${wrap ? " wrap" : ""}`} role="group">{children}</div>;
}
export function Pill({ tone, dot, children, title }: { tone?: "green" | "amber" | "orange" | "red" | "blue" | "hivis" | "grey"; dot?: boolean; children: ReactNode; title?: string }) {
  return <span className={`pill${tone && tone !== "grey" ? ` ${tone}` : ""}${dot ? " dot" : ""}`} title={title}>{children}</span>;
}
export function BandPill({ band, score }: { band: Band | null | undefined; score?: number | null }) {
  const { t } = useI18n();
  if (!band) return null;
  return <Pill tone={BAND_COLOUR[band]} dot>{t(`band.${band}`)}{score ? ` · ${score}` : ""}</Pill>;
}

/* ---------------------------------------------------------------- cards */
export function Card({ children, className = "", flat, pad0, onClick, as: As = "div", ...rest }: { children: ReactNode; className?: string; flat?: boolean; pad0?: boolean; onClick?: () => void; as?: "div" | "section" | "article" } & Record<string, unknown>) {
  const cls = ["card", flat ? "flat" : "", pad0 ? "pad-0" : "", onClick ? "clickable" : "", className].filter(Boolean).join(" ");
  const Tag = As as "div";
  return (
    <Tag className={cls} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined} {...rest}>
      {children}
    </Tag>
  );
}
export function CardHead({ title, action, kicker }: { title: ReactNode; action?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="card-head">
      <div>
        {kicker ? <div className="kicker">{kicker}</div> : null}
        <h3>{title}</h3>
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- sheet / dialog */
export function Sheet({ title, onClose, children, footer, wide, closeLabel }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; closeLabel?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([aria-label])");
    (first ?? ref.current)?.focus?.();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [onClose]);
  const id = useId();
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className={`sheet${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="grab" aria-hidden />
        <div className="sheet-head">
          <h2 id={id}>{title}</h2>
          <Button variant="ghost" icon onClick={onClose} aria-label={closeLabel ?? t("common.close")}><IconX /></Button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </>
  );
}

/** Confirmation sheet with a reason field when `reasonRequired`. */
export function Confirm({ title, body, confirmLabel, danger, reasonRequired, reasonLabel, onConfirm, onClose }: {
  title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; reasonRequired?: boolean; reasonLabel?: string;
  onConfirm: (reason: string) => void | Promise<void>; onClose: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = !reasonRequired || reason.trim().length >= 3;
  return (
    <Sheet title={title} onClose={onClose} footer={
      <>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant={danger ? "danger" : "primary"} disabled={!ok} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } }}>{confirmLabel}</Button>
      </>
    }>
      {body ? <p>{body}</p> : null}
      {reasonRequired ? (
        <Field label={reasonLabel ?? t("common.reason")} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
        </Field>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- toasts with undo */
export interface ToastOptions { tone?: "default" | "error" | "success"; actionLabel?: string; onAction?: () => void; durationMs?: number; onExpire?: () => void }
interface ToastItem extends ToastOptions { id: number; message: string }
interface ToastApi {
  show: (message: string, opts?: ToastOptions) => number;
  error: (message: string) => number;
  success: (message: string) => number;
  /** Soft-delete pattern: runs `commit` after the toast expires unless Undo was pressed (then runs `undo`). */
  undoable: (message: string, commit: () => void | Promise<void>, undo: () => void, durationMs?: number) => number;
  dismiss: (id: number) => void;
}
const ToastCtx = createContext<ToastApi | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const seq = useRef(1);
  const dismiss = useCallback((id: number) => {
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);
  const show = useCallback((message: string, opts: ToastOptions = {}) => {
    const id = seq.current++;
    const durationMs = opts.durationMs ?? (opts.onAction ? 8000 : 4000);
    setItems((xs) => [...xs.slice(-2), { id, message, ...opts, durationMs }]);
    const tm = window.setTimeout(() => { opts.onExpire?.(); dismiss(id); }, durationMs);
    timers.current.set(id, tm);
    return id;
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    show,
    error: (m) => show(m, { tone: "error", durationMs: 6000 }),
    success: (m) => show(m, { tone: "success" }),
    undoable: (message, commit, undo, durationMs = 8000) => {
      let undone = false;
      return show(message, {
        actionLabel: t("common.undo"), durationMs,
        onAction: () => { undone = true; undo(); },
        onExpire: () => { if (!undone) void commit(); },
      });
    },
    dismiss,
  }), [show, dismiss, t]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((it) => (
          <div key={it.id} className={`toast${it.tone && it.tone !== "default" ? ` ${it.tone}` : ""}`} role={it.tone === "error" ? "alert" : "status"} style={{ "--dur": `${it.durationMs}ms` } as React.CSSProperties}>
            <span className="msg">{it.message}</span>
            {it.actionLabel ? (
              <button type="button" className="act" onClick={() => { it.onAction?.(); dismiss(it.id); }}>{it.actionLabel}</button>
            ) : null}
            <button type="button" className="act" aria-label={t("common.close")} onClick={() => { it.onExpire?.(); dismiss(it.id); }}><IconX size={16} /></button>
            {it.onAction ? <span className="bar" aria-hidden /> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast(): ToastApi {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("useToast must be used inside <ToastProvider>");
  return c;
}

/* ---------------------------------------------------------------- skeleton, empty, error */
export function Skeleton({ lines = 3, block, className = "" }: { lines?: number; block?: boolean; className?: string }) {
  if (block) return <div className={`skeleton skel-block ${className}`} aria-hidden />;
  const widths = ["", "w70", "w50", "", "w30"];
  return (
    <div className={className} aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => <div key={i} className={`skeleton skel-line ${widths[i % widths.length]}`} />)}
    </div>
  );
}
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="list" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton skel-block" />)}
    </div>
  );
}
export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <div className="ico">{icon ?? <IconInbox />}</div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}
export function SearchEmpty({ q, onClear }: { q: string; onClear?: () => void }) {
  const { t } = useI18n();
  return <EmptyState icon={<IconSearch />} title={t("empty.search", { q })} body={t("empty.searchHint")} action={onClear ? <Button size="sm" onClick={onClear}>{t("common.clearFilters")}</Button> : undefined} />;
}
export function ErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const toast = useContext(ToastCtx);
  const msg = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
  return (
    <div className="error-card" role="alert">
      <h3><IconAlert size={18} style={{ display: "inline", verticalAlign: "-3px", marginRight: 6 }} />{t("error.title")}</h3>
      <p>{msg}</p>
      <div className="btn-group">
        {onRetry ? <Button size="sm" variant="primary" onClick={onRetry}><IconRefresh size={16} />{t("common.retry")}</Button> : null}
        <Button size="sm" onClick={async () => { if (await copyText(details)) toast?.success(t("common.copied")); }}>{t("common.copyDetails")}</Button>
      </div>
    </div>
  );
}
interface EBProps { children: ReactNode; t: TFn; onReset?: () => void }
class ErrorBoundaryInner extends Component<EBProps, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[safeworks] screen crashed", error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    const { t } = this.props;
    const details = `${this.state.error.name}: ${this.state.error.message}\n${this.state.error.stack ?? ""}`;
    return (
      <div className="page">
        <div className="error-card" role="alert">
          <h3>{t("error.title")}</h3>
          <p>{t("error.body")}</p>
          <pre>{this.state.error.message}</pre>
          <div className="btn-group">
            <Button variant="primary" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>{t("common.retry")}</Button>
            <Button onClick={() => location.reload()}>{t("common.reload")}</Button>
            <Button onClick={() => void copyText(details)}>{t("common.copyDetails")}</Button>
          </div>
        </div>
      </div>
    );
  }
}
export function ErrorBoundary({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  const { t } = useI18n();
  return <ErrorBoundaryInner t={t} onReset={onReset}>{children}</ErrorBoundaryInner>;
}

/* ---------------------------------------------------------------- fields */
export function Field({ label, hint, error, required, children, optional }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; optional?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={`field${error ? " invalid" : ""}`}>
      <label htmlFor={id}>
        {label}{required ? <span className="req" aria-hidden>*</span> : null}
        {optional ? <span className="muted"> · {t("common.optional")}</span> : null}
      </label>
      <FieldIdCtx.Provider value={id}>{children}</FieldIdCtx.Provider>
      {hint && !error ? <div className="hint">{hint}</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
    </div>
  );
}
const FieldIdCtx = createContext<string | undefined>(undefined);
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  const id = useContext(FieldIdCtx);
  return <input id={p.id ?? id} className={`input ${p.className ?? ""}`} {...p} />;
}
export function Textarea({ maxLength, value, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { t } = useI18n();
  const id = useContext(FieldIdCtx);
  const len = typeof value === "string" ? value.length : 0;
  return (
    <>
      <textarea id={p.id ?? id} className={`textarea ${p.className ?? ""}`} maxLength={maxLength} value={value} {...p} />
      {maxLength ? <div className="counter">{t("common.characters", { count: len, max: maxLength })}</div> : null}
    </>
  );
}
export function Select({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useContext(FieldIdCtx);
  return <select id={p.id ?? id} className={`select ${p.className ?? ""}`} {...p}>{children}</select>;
}
export function Toggle({ label, hint, checked, onChange, danger, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; danger?: boolean; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="toggle" onClick={() => !disabled && onChange(!checked)}>
      <span className="txt"><label htmlFor={id} onClick={(e) => e.stopPropagation()}>{label}</label>{hint ? <small>{hint}</small> : null}</span>
      <button id={id} type="button" role="switch" aria-checked={checked} className={`switch${danger ? " danger" : ""}`} disabled={disabled} onClick={(e) => { e.stopPropagation(); onChange(!checked); }} />
    </div>
  );
}
export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; ariaLabel?: string }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}
export function Form({ onSubmit, children, className }: { onSubmit: () => void | Promise<void>; children: ReactNode; className?: string }) {
  return (
    <form className={className} onSubmit={(e: FormEvent) => { e.preventDefault(); void onSubmit(); }} noValidate>
      {children}
    </form>
  );
}

/* ---------------------------------------------------------------- tabs, progress, banner */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.value} role="tab" type="button" aria-selected={tb.value === value} onClick={() => onChange(tb.value)}>
          {tb.label}{tb.count !== undefined ? <span className="n">{tb.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
export function Progress({ value, max = 100, hivis, label }: { value: number; max?: number; hivis?: boolean; label?: string }) {
  const pctv = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`progress${hivis ? " hivis" : ""}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span style={{ width: `${pctv}%` }} />
    </div>
  );
}
export function Banner({ tone, children, action, icon }: { tone: "offline" | "synced" | "failed" | "info" | "warn" | "critical"; children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === "critical" || tone === "failed" ? "alert" : "status"}>
      {icon}
      <span>{children}</span>
      <span className="spacer" />
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- risk matrix */
export function RiskMatrix({ matrix, likelihood, severity, onChange, readOnly }: { matrix?: RiskMatrixVersion | null; likelihood: number | null; severity: number | null; onChange?: (l: number, s: number) => void; readOnly?: boolean }) {
  const { t, pick } = useI18n();
  const n = matrix?.size ?? 5;
  const ls = Array.from({ length: n }, (_, i) => n - i); // top row = highest likelihood
  const ss = Array.from({ length: n }, (_, i) => i + 1);
  const lLabel = (v: number) => (matrix ? pick(matrix.likelihoodLabels.find((x) => x.v === v)?.label) : t(`likelihood.${v}`));
  const sLabel = (v: number) => (matrix ? pick(matrix.severityLabels.find((x) => x.v === v)?.label) : t(`severity.${v}`));
  const { score, band } = bandFor(matrix, likelihood, severity);
  return (
    <div>
      <div className="matrix" style={{ "--n": n } as React.CSSProperties} role="grid" aria-label={`${t("matrix.likelihood")} × ${t("matrix.severity")}`}>
        <div className="hd" aria-hidden>{t("matrix.likelihood")} ↓ · {t("matrix.severity")} →</div>
        {ss.map((s) => <div key={`h${s}`} className="hd" title={sLabel(s)}>{s}</div>)}
        {ls.map((l) => (
          <div key={`r${l}`} style={{ display: "contents" }} role="row">
            <div className="hd" title={lLabel(l)}>{l}</div>
            {ss.map((s) => {
              const on = likelihood === l && severity === s;
              const dim = (likelihood !== null && severity !== null) && !on && !(likelihood === l || severity === s);
              return (
                <button key={`${l}-${s}`} type="button" role="gridcell" aria-selected={on} aria-label={`${lLabel(l)} × ${sLabel(s)} = ${l * s}`}
                  className={`cell ${cellColour(matrix, l, s)}${on ? " on" : ""}${dim ? " dim" : ""}`} disabled={readOnly} onClick={() => onChange?.(l, s)}>
                  {l * s}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="matrix-legend">
        {(["low", "moderate", "high", "extreme"] as Band[]).map((b) => <span key={b} className="band-chip" style={{ color: `var(--${BAND_COLOUR[b] === "amber" ? "amber" : BAND_COLOUR[b]})` }}><span className="band-swatch" style={{ background: "currentColor" }} /> {t(`band.${b}`)}</span>)}
      </div>
      {score && band ? (
        <div className="row" style={{ marginTop: 8, gap: 10 }}>
          <BandPill band={band} score={score} />
          <span className="small">{likelihood ? lLabel(likelihood) : ""} × {severity ? sLabel(severity) : ""}</span>
        </div>
      ) : null}
      {band ? <p className="small muted" style={{ marginTop: 6 }}>{matrix ? pick(matrix.bands.find((x) => x.band === band)?.response) : t(`band.response.${band}`)}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- media */
export function Thumb({ media, src, onClick, onRemove, tag, pending, alt }: { media?: Media; src?: string; onClick?: () => void; onRemove?: () => void; tag?: string; pending?: boolean; alt?: string }) {
  const { t } = useI18n();
  const url = src ?? media?.url ?? null;
  return (
    <div className={`thumb${pending || (media && media.uploadStatus === "pending") ? " pending" : ""}`}>
      {url ? <img src={url} alt={alt ?? ""} loading="lazy" onClick={onClick} style={onClick ? { cursor: "zoom-in" } : undefined} /> : <div className="skeleton" style={{ width: "100%", height: "100%" }} />}
      {tag ? <span className="tag">{tag}</span> : null}
      {onRemove ? <button type="button" className="rm" aria-label={t("common.remove")} onClick={onRemove}><IconX size={16} /></button> : null}
    </div>
  );
}
export function Lightbox({ src, onClose, caption }: { src: string; onClose: () => void; caption?: string }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" style={{ display: "grid", placeItems: "center", background: "rgba(0,0,0,.9)", zIndex: 80 }} onClick={onClose} role="dialog" aria-modal="true" aria-label={caption ?? t("common.photo")}>
      <img src={src} alt={caption ?? ""} style={{ maxWidth: "96vw", maxHeight: "86vh", objectFit: "contain", borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
      {caption ? <div style={{ position: "absolute", bottom: 24, color: "#fff", fontWeight: 600 }}>{caption}</div> : null}
      <button type="button" className="btn ghost icon" style={{ position: "absolute", top: 12, right: 12, color: "#fff" }} aria-label={t("common.close")} onClick={onClose}><IconX /></button>
    </div>
  );
}

/* ---------------------------------------------------------------- timeline, kpi */
export function Timeline({ items }: { items: { key: string | number; tone?: "green" | "red" | "blue" | "hivis" | "grey"; who: ReactNode; when: ReactNode; text?: ReactNode; extra?: ReactNode }[] }) {
  return (
    <ol className="timeline">
      {items.map((it) => (
        <li key={it.key}>
          <div className={`dot${it.tone && it.tone !== "grey" ? ` ${it.tone}` : ""}`} aria-hidden />
          <div className="ev">
            <span className="who">{it.who}</span><span className="when">{it.when}</span>
            {it.text ? <div className="txt">{it.text}</div> : null}
            {it.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function KpiTile({ value, label, n, tone, hint }: { value: ReactNode; label: ReactNode; n?: ReactNode; tone?: "red" | "green" | "orange"; hint?: string }) {
  return (
    <div className={`kpi${tone ? ` ${tone}` : ""}`} title={hint}>
      <span className="v">{value}</span>
      <span className="l">{label}</span>
      {n !== undefined ? <span className="n">{n}</span> : null}
    </div>
  );
}
export function Bars({ rows, colour }: { rows: { label: ReactNode; n: number; sub?: number }[]; colour?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="b" key={i}>
          <span className="truncate">{r.label}</span>
          <span className="track"><span style={{ width: `${(r.n / max) * 100}%`, background: colour }} /></span>
          <span className="n">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- table + pagination */
export interface Column<T> { key: string; label: ReactNode; render: (row: T) => ReactNode; num?: boolean; width?: string | number; sortable?: boolean }
export function DataTable<T>({ columns, rows, rowKey, onRow, empty, sort, onSort, loading }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: ReactNode; sort?: { key: string; dir: "asc" | "desc" }; onSort?: (key: string) => void; loading?: boolean }) {
  if (loading && rows.length === 0) return <ListSkeleton rows={6} />;
  if (!loading && rows.length === 0) return <>{empty}</>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? "num" : undefined} style={{ width: c.width }} aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                {c.sortable && onSort ? <button type="button" onClick={() => onSort(c.key)}>{c.label}{sort?.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</button> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={onRow ? "clickable" : undefined} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
              onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>
              {columns.map((c) => <td key={c.key} className={c.num ? "num" : undefined}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <span>{t("common.rows", { from, to, total })}</span>
      <div className="btn-group">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</Button>
        <span style={{ alignSelf: "center" }}>{t("common.page", { page, pages })}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shortcuts help */
export function ShortcutsHelp({ items, onClose }: { items: { keys: string[]; label: string }[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={<span className="row"><IconKeyboard /> {t("shortcuts.title")}</span>} onClose={onClose}>
      <div className="shortcuts">
        {items.map((it, i) => (
          <div key={i} style={{ display: "contents" }}>
            <span>{it.keys.map((k, j) => <span key={j}><kbd>{k}</kbd>{j < it.keys.length - 1 ? " " : ""}</span>)}</span>
            <span>{it.label}</span>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
/** Wires `?` to the help sheet; returns the element to render. */
export function useShortcutsHelp(items: { keys: string[]; label: string }[]) {
  const [open, setOpen] = useState(false);
  useHotkeys([{ keys: "?", handler: () => setOpen(true) }, { keys: "shift+?", handler: () => setOpen(true) }]);
  return open ? <ShortcutsHelp items={items} onClose={() => setOpen(false)} /> : null;
}

/* ---------------------------------------------------------------- misc */
export function SuccessMark({ size = 56 }: { size?: number }) {
  return <div style={{ color: "var(--green)", display: "grid", placeItems: "center" }}><IconCheckCircle size={size} /></div>;
}
export function I18nText({ value }: { value: I18n | string | null | undefined }) {
  const { pick } = useI18n();
  return <>{pick(value)}</>;
}
