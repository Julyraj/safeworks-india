import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { dueText, fmtDate, STATUS_LABEL } from "./format";
import { IconX } from "./icons";
import type { ObsListItem, RiskLevel, Status } from "./types";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="spinner" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function StatusPill({ status, overdue }: { status: Status; overdue?: boolean }) {
  if (overdue) return <span className="pill overdue">Overdue</span>;
  return <span className={`pill s-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Risk({ level }: { level: RiskLevel | null | undefined }) {
  if (!level) return null;
  return <span className={`risk risk-${level}`}>{level}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="alert err" role="alert">
      {msg}
    </div>
  );
}

export function ObsRow({ o, to, fileUrl }: { o: ObsListItem; to: string; fileUrl: (u: string | null) => string }) {
  const due = dueText(o.dueAt, o.status);
  return (
    <Link to={to} className="obs-row">
      <span className={`strip r-${o.riskLevel ?? "none"} ${o.overdue ? "barricade" : ""}`} aria-hidden />
      <span className="body">
        <span className="row-wrap" style={{ gap: 8 }}>
          <span className="code small">{o.code}</span>
          <StatusPill status={o.status} overdue={o.overdue} />
          <Risk level={o.riskLevel} />
          {o.isRepeat && <span className="pill">Repeat</span>}
        </span>
        <span className="title">{o.item || o.hazard || o.description}</span>
        <span className="meta">
          <span>{o.typeLabel}</span>
          <span>
            {o.site.name}
            {o.area ? ` · ${o.area}` : ""}
          </span>
          {o.ownerName && <span>Owner: {o.ownerName}</span>}
          {o.status === "closed" ? (
            <span>Closed {fmtDate(o.closedAt)}</span>
          ) : o.status === "noted" ? (
            <span>Raised {fmtDate(o.raisedAt)}</span>
          ) : (
            <span className={due.late ? "due-late" : ""}>{due.text}</span>
          )}
        </span>
      </span>
      {o.thumbUrl ? <img className="thumb" src={fileUrl(o.thumbUrl)} alt="" loading="lazy" /> : <span className="thumb-empty" />}
    </Link>
  );
}

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.close-x)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={wide ? { maxWidth: 760 } : undefined}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn close-x" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Photo">
      <img src={src} alt="" />
      <button className="icon-btn" aria-label="Close photo" onClick={onClose}>
        <IconX size={28} />
      </button>
    </div>
  );
}

// ---------- Toasts ----------
type Toast = { id: number; text: string; err?: boolean };
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, err?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.slice(-1).map((t) => (
          <div key={t.id} className={`toast ${t.err ? "err" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------- Data loading ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

export function Bars({ rows, max, color }: { rows: { label: string; n: number }[]; max?: number; color?: string }) {
  if (!rows.length) return <p className="muted small">No data in this period.</p>;
  const m = max ?? Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span className="lbl" title={r.label}>
            {r.label}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.n / m) * 100}%`, display: "block", background: color }} />
          </span>
          <span className="v">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

/** Raised vs closed per week, as paired columns. */
export function WeeklyChart({ weeks }: { weeks: { week: string; raised: number; closed: number }[] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.raised, w.closed]));
  const W = 640, H = 180, pad = 26, bw = (W - pad * 2) / weeks.length;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H + 24}`} width="100%" role="img" aria-label="Observations raised and closed per week, last 12 weeks">
        <line x1={pad} x2={W - pad} y1={H} y2={H} stroke="var(--line-strong)" />
        {weeks.map((w, i) => {
          const x = pad + i * bw;
          const hr = (w.raised / max) * (H - 20);
          const hc = (w.closed / max) * (H - 20);
          const d = new Date(w.week + "T00:00:00");
          return (
            <g key={w.week}>
              <rect x={x + bw * 0.14} y={H - hr} width={bw * 0.34} height={hr} fill="var(--ink-2)" rx="2">
                <title>{`Week of ${d.toDateString()}: ${w.raised} raised`}</title>
              </rect>
              <rect x={x + bw * 0.52} y={H - hc} width={bw * 0.34} height={hc} fill="var(--green)" rx="2">
                <title>{`Week of ${d.toDateString()}: ${w.closed} closed`}</title>
              </rect>
              {i % 2 === 0 && (
                <text x={x + bw / 2} y={H + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">
                  {d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="row small muted" style={{ gap: 16 }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 12, background: "var(--ink-2)", display: "inline-block", borderRadius: 2 }} /> Raised
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 12, height: 12, background: "var(--green)", display: "inline-block", borderRadius: 2 }} /> Closed
        </span>
      </figcaption>
    </figure>
  );
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}
