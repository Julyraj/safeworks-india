/* Console-only building blocks on top of the shared kit: drawer, page head, register plumbing (persisted filters,
   saved filters, j/k navigation, export), 4-language inputs, status tags, one-time secrets, CSV import, owner picker. */
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n, LANGS, LANG_NAMES } from "../../shared/i18n";
import type { I18n, Lang, Paged, StatusLabel, UserAdmin, ImportResult } from "../../shared/types";
import { Button, Chip, Field, Input, Pill, Select, Skeleton, ErrorCard, useToast, Textarea, Sheet, EmptyState } from "../../shared/ui";
import { useDebounced, useLocalState, type Loaded } from "../../shared/hooks";
import { IconCopy, IconDownload, IconFilter, IconPlus, IconSearch, IconUpload, IconX, IconCheckCircle, IconAlert, IconEyeOff } from "../../shared/icons";
import { copyText } from "../../shared/storage";
import { api, asPaged, errMessage, parseCsv } from "../api";
import type { SavedFilter } from "../types";
import { useScope } from "../scope";

/* ------------------------------------------------------------- page head */
export function PageHead({ title, sub, tools }: { title: ReactNode; sub?: ReactNode; tools?: ReactNode }) {
  return (
    <div className="ph">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {tools ? <div className="tools">{tools}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------- drawer */
export function Drawer({ title, kicker, onClose, children, footer, wide }: { title: ReactNode; kicker?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden />
      <aside className={`drawer${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="drawer-head">
          <div className="grow">
            {kicker ? <div className="kicker">{kicker}</div> : null}
            <h2 id={id}>{title}</h2>
          </div>
          <Button variant="ghost" icon onClick={onClose} aria-label={t("common.close")}><IconX /></Button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}

/* ------------------------------------------------------------- load state */
export function Loader<T>({ state, skeleton, children }: { state: Loaded<T>; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  if (state.error && !state.data) return <ErrorCard error={state.error} onRetry={state.reload} />;
  if (!state.data) return <>{skeleton ?? <Skeleton lines={5} />}</>;
  return <>{children(state.data)}</>;
}

/* ------------------------------------------------------------- registers */
export type FilterValues = Record<string, string>;
export interface RegisterState<T> {
  filters: FilterValues;
  setFilter: (k: string, v: string) => void;
  clearFilters: () => void;
  q: string; setQ: (v: string) => void; qDebounced: string;
  page: number; setPage: (p: number) => void; pageSize: number;
  sort: { key: string; dir: "asc" | "desc" } | null; toggleSort: (k: string) => void;
  data: Paged<T> | null; loading: boolean; error: unknown; reload: () => void;
  setData: (d: Paged<T> | null) => void;
  patch: (pred: (row: T) => boolean, next: (row: T) => T) => void;
  saved: SavedFilter[]; saveCurrent: (name: string) => void; applySaved: (f: SavedFilter) => void; removeSaved: (name: string) => void;
  hasFilters: boolean;
  queryParams: Record<string, string | number | undefined>;
}

/** Server-paged register with filters persisted per screen, debounced search and saved filters. */
export function useRegister<T>(key: string, path: string, opts: { defaults?: FilterValues; pageSize?: number; scopeSite?: boolean; extra?: Record<string, string | number | undefined>; mapRow?: (r: unknown) => T } = {}): RegisterState<T> {
  const { siteId } = useScope();
  const pageSize = opts.pageSize ?? 25;
  const [filters, setFilters] = useLocalState<FilterValues>(`sw.admin.f.${key}`, opts.defaults ?? {});
  const [saved, setSaved] = useLocalState<SavedFilter[]>(`sw.admin.sf.${key}`, []);
  const [q, setQ] = useState(filters.q ?? "");
  const qDebounced = useDebounced(q, 300);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useLocalState<{ key: string; dir: "asc" | "desc" } | null>(`sw.admin.sort.${key}`, null);
  const [data, setData] = useState<Paged<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [n, setN] = useState(0);
  useEffect(() => { setPage(1); }, [qDebounced, filters, siteId, sort]);
  const queryParams = useMemo(() => {
    const p: Record<string, string | number | undefined> = { ...filters, q: qDebounced || undefined, page, pageSize, ...(opts.extra ?? {}) };
    if (opts.scopeSite !== false && siteId) p.siteId = siteId;
    if (sort) { p.sort = sort.key; p.dir = sort.dir; }
    for (const k of Object.keys(p)) if (p[k] === "" || p[k] === undefined) delete p[k];
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, qDebounced, page, pageSize, siteId, sort, JSON.stringify(opts.extra ?? {})]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(path, queryParams).then((r) => {
      if (!alive) return;
      const paged = asPaged<unknown>(r, page, pageSize);
      setData({ ...paged, items: opts.mapRow ? paged.items.map(opts.mapRow) : (paged.items as T[]) });
      setError(null);
    }, (e) => { if (alive) setError(e); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, queryParams, n]);
  const hasFilters = Object.entries(filters).some(([k, v]) => v && v !== (opts.defaults ?? {})[k]) || !!q;
  return {
    filters,
    setFilter: (k, v) => setFilters((f) => ({ ...f, [k]: v })),
    clearFilters: () => { setFilters(opts.defaults ?? {}); setQ(""); },
    q, setQ, qDebounced,
    page, setPage, pageSize,
    sort, toggleSort: (k) => setSort((s) => (s?.key === k ? (s.dir === "asc" ? { key: k, dir: "desc" } : null) : { key: k, dir: "asc" })),
    data, loading, error, reload: () => setN((x) => x + 1), setData,
    patch: (pred, next) => setData((d) => (d ? { ...d, items: d.items.map((r) => (pred(r) ? next(r) : r)) } : d)),
    saved,
    saveCurrent: (name) => setSaved((s) => [...s.filter((x) => x.name !== name), { name, values: { ...filters, q } }]),
    applySaved: (f) => { const { q: fq, ...rest } = f.values; setFilters(rest); setQ(fq ?? ""); },
    removeSaved: (name) => setSaved((s) => s.filter((x) => x.name !== name)),
    hasFilters,
    queryParams,
  };
}

/** Applies `?status=&band=&q=&siteId=` from a link (attention board, dashboard) to a register once, then cleans the URL. */
export function useUrlFilters<T>(reg: RegisterState<T>, keys: string[]) {
  const [params, setParams] = useSearchParams();
  const { setSiteId } = useScope();
  useEffect(() => {
    if ([...params.keys()].length === 0) return;
    let touched = false;
    for (const k of keys) { const v = params.get(k); if (v !== null) { reg.setFilter(k, v); touched = true; } }
    const q = params.get("q"); if (q !== null) { reg.setQ(q); touched = true; }
    const s = params.get("siteId"); if (s !== null) { setSiteId(s); touched = true; }
    if (touched) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function SavedFilters<T>({ reg }: { reg: RegisterState<T> }) {
  const { t } = useI18n();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  return (
    <div className="saved-filters">
      <IconFilter size={16} style={{ color: "var(--muted)" }} />
      {reg.saved.length === 0 && !reg.hasFilters ? <span className="small muted">{t("reg.noSaved")}</span> : null}
      {reg.saved.map((f) => (
        <Chip key={f.name} on={JSON.stringify({ ...reg.filters, q: reg.q }) === JSON.stringify(f.values)} onClick={() => reg.applySaved(f)} title={t("reg.applyFilter")}>
          {f.name}
          <span className="x" role="button" aria-label={t("reg.removeFilter", { name: f.name })} onClick={(e) => { e.stopPropagation(); reg.removeSaved(f.name); }}><IconX size={12} /></span>
        </Chip>
      ))}
      {reg.hasFilters ? (
        naming ? (
          <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { reg.saveCurrent(name.trim()); setName(""); setNaming(false); } }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("reg.filterName")} style={{ minHeight: 30, width: 160, padding: "2px 8px", fontSize: 13 }} autoFocus />
            <Button size="sm" type="submit" variant="primary">{t("common.save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>{t("common.cancel")}</Button>
          </form>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setNaming(true)}><IconPlus size={14} />{t("reg.saveFilter")}</Button>
            <Button size="sm" variant="ghost" onClick={reg.clearFilters}>{t("common.clearFilters")}</Button>
          </>
        )
      ) : null}
    </div>
  );
}

/** Search box for a register; `/` focuses it through the shell's search registry. */
export function RegisterSearch<T>({ reg, placeholder }: { reg: RegisterState<T>; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <div className="field grow-search">
      <label>{t("common.search")}</label>
      <div style={{ position: "relative" }}>
        <IconSearch size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
        <Input data-register-search value={reg.q} onChange={(e) => reg.setQ(e.target.value)} placeholder={placeholder ?? t("reg.searchPlaceholder")} style={{ paddingLeft: 32 }} />
      </div>
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, allLabel }: { label: ReactNode; value: string; onChange: (v: string) => void; options: { value: string; label: ReactNode }[]; allLabel?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel ?? t("common.all")}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </Field>
  );
}

export function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t("reg.from")}><Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} /></Field>
      <Field label={t("reg.to")}><Input type="date" value={to} onChange={(e) => onTo(e.target.value)} /></Field>
    </>
  );
}

export function ExportButton({ onExport, label }: { onExport: () => Promise<void>; label?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { await onExport(); toast.success(t("reg.exportStarted")); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); } }}>
      <IconDownload size={16} />{label ?? t("common.export")}
    </Button>
  );
}

/** j / k move focus between rows of the table inside `ref`; Enter opens (the kit's DataTable handles Enter on a focused row). */
export function useRowNav(ref: React.RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "k") return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT" || tgt.isContentEditable)) return;
      if (document.querySelector(".sheet, .drawer")) return;
      const rows = Array.from(ref.current?.querySelectorAll<HTMLTableRowElement>("tbody tr[tabindex]") ?? []);
      if (rows.length === 0) return;
      e.preventDefault();
      const cur = rows.findIndex((r) => r === document.activeElement);
      const next = e.key === "j" ? Math.min(rows.length - 1, cur + 1) : Math.max(0, cur <= 0 ? 0 : cur - 1);
      rows[next]?.focus();
      rows[next]?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref, enabled]);
}

export function CountLine({ total, loading }: { total: number | undefined; loading: boolean }) {
  const { t } = useI18n();
  if (loading && total === undefined) return <div className="count-line">{t("common.loading")}</div>;
  return <div className="count-line">{t("reg.count", { count: total ?? 0 })}</div>;
}

/* ------------------------------------------------------------- i18n inputs */
export function I18nInput({ value, onChange, textarea, required, label, hint, error }: { value: I18n | Record<string, string> | null | undefined; onChange: (v: I18n) => void; textarea?: boolean; required?: boolean; label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const v: Record<string, string> = { en: "", ...(value ?? {}) };
  const set = (l: Lang, s: string) => onChange({ ...(v as I18n), [l]: s, en: l === "en" ? s : v.en });
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <div className="lang-grid">
        {LANGS.map((l) => (
          <div key={l}>
            <span className="lg">{LANG_NAMES[l]}</span>
            {textarea
              ? <Textarea rows={2} value={v[l] ?? ""} onChange={(e) => set(l, e.target.value)} aria-label={LANG_NAMES[l]} />
              : <Input value={v[l] ?? ""} onChange={(e) => set(l, e.target.value)} aria-label={LANG_NAMES[l]} />}
          </div>
        ))}
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------- status tags */
const STATUS_TONE: Record<string, "green" | "blue" | "amber" | "orange" | "red" | "grey"> = {
  verified_primary: "green", verified_secondary: "blue", voluntary_standard: "amber", company_standard: "grey", reference_to_confirm: "orange", draft_rule: "red", unverified: "orange", provisional: "amber",
};
/** The status label next to every configurable value (brief §8): a known key is translated, free text is shown as-is. */
export function StatusTag({ label }: { label: string | StatusLabel | null | undefined }) {
  const { t } = useI18n();
  if (!label) return null;
  const known = STATUS_TONE[label];
  const text = known ? t(`common.verifyLabel.${label}`) : label === "design default" ? t("common.designDefault") : label;
  return <Pill tone={known ?? "grey"} title={t("status.tagHint")}>{text}</Pill>;
}
export function StatusSelect({ value, onChange }: { value: StatusLabel; onChange: (v: StatusLabel) => void }) {
  const { t } = useI18n();
  const all: StatusLabel[] = ["verified_primary", "verified_secondary", "voluntary_standard", "company_standard", "reference_to_confirm"];
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as StatusLabel)}>
      {all.map((s) => <option key={s} value={s}>{t(`common.verifyLabel.${s}`)}</option>)}
    </Select>
  );
}

/* ------------------------------------------------------------- one-time secret */
export function SecretOnce({ value, label, hint }: { value: string; label: ReactNode; hint?: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const [shown, setShown] = useState(true);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="label">{label}</div>
      <div className="secret">
        <code aria-label={String(label)}>{shown ? value : "•".repeat(Math.min(16, value.length))}</code>
        <Button size="sm" variant="ghost" icon onClick={() => setShown((s) => !s)} aria-label={shown ? t("secret.hide") : t("secret.show")}><IconEyeOff size={16} /></Button>
        <Button size="sm" onClick={async () => { if (await copyText(value)) toast.success(t("common.copied")); }}><IconCopy size={16} />{t("common.copy")}</Button>
      </div>
      <div className="banner warn" role="status"><IconAlert size={16} /><span>{hint ?? t("secret.once")}</span></div>
    </div>
  );
}

export function Copyable({ value }: { value: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <span className="row nowrap" style={{ gap: 4 }}>
      <code className="mono-sm truncate" style={{ maxWidth: 240 }}>{value}</code>
      <Button size="sm" variant="ghost" icon onClick={async () => { if (await copyText(value)) toast.success(t("common.copied")); }} aria-label={t("common.copy")}><IconCopy size={14} /></Button>
    </span>
  );
}

/* ------------------------------------------------------------- chips multi-select */
export function ChipsSelect<T extends string>({ options, value, onChange, ariaLabel }: { options: { value: T; label: ReactNode }[]; value: T[]; onChange: (v: T[]) => void; ariaLabel?: string }) {
  return (
    <div className="chips-select" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <Chip key={o.value} on={value.includes(o.value)} onClick={() => onChange(value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value])}>{o.label}</Chip>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- CSV import */
export interface CsvColumn { key: string; label: string; required?: boolean; validate?: (v: string, row: Record<string, string>) => string | null; options?: string[] }
export interface CsvImportProps {
  columns: CsvColumn[];
  sample: string;
  onImport: (csv: string) => Promise<ImportResult>;
  onDone?: (r: ImportResult) => void;
  title?: ReactNode;
}
/** Paste or upload → preview with validation → import → ImportResult. */
export function CsvImport({ columns, sample, onImport, onDone, title }: CsvImportProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const parsed = useMemo(() => {
    const rows = parseCsv(text);
    if (rows.length === 0) return { header: [] as string[], rows: [] as Record<string, string>[], problems: [] as { row: number; col: string; msg: string }[], unknownHeader: false };
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const known = columns.map((c) => c.key);
    const unknownHeader = !header.some((h) => known.includes(h));
    const body = (unknownHeader ? rows : rows.slice(1)).map((cells) => {
      const o: Record<string, string> = {};
      (unknownHeader ? known : header).forEach((h, i) => { o[h] = (cells[i] ?? "").trim(); });
      return o;
    });
    const problems: { row: number; col: string; msg: string }[] = [];
    body.forEach((r, i) => {
      for (const c of columns) {
        const v = r[c.key] ?? "";
        if (c.required && !v) problems.push({ row: i, col: c.key, msg: t("csv.required") });
        else if (v && c.options && !c.options.includes(v)) problems.push({ row: i, col: c.key, msg: t("csv.notAllowed", { allowed: c.options.join(", ") }) });
        else if (v && c.validate) { const m = c.validate(v, r); if (m) problems.push({ row: i, col: c.key, msg: m }); }
      }
    });
    return { header: unknownHeader ? known : header, rows: body, problems, unknownHeader };
  }, [text, columns, t]);
  const readFile = (f: File | undefined) => { if (!f) return; f.text().then(setText).catch(() => toast.error(t("csv.readFailed"))); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files?.[0]); };
  const bad = parsed.problems.length;
  if (result) {
    return (
      <div className="stack">
        <div className="row"><IconCheckCircle style={{ color: "var(--green)" }} /><h3 style={{ margin: 0 }}>{t("csv.done")}</h3></div>
        <div className="import-result">
          <div className="kpi green"><span className="v">{result.created}</span><span className="l">{t("csv.created")}</span></div>
          <div className="kpi"><span className="v">{result.updated}</span><span className="l">{t("csv.updated")}</span></div>
          <div className="kpi"><span className="v">{result.skipped}</span><span className="l">{t("csv.skipped")}</span></div>
        </div>
        {result.errors.length ? (
          <div className="table-wrap"><table className="table"><thead><tr><th>{t("csv.row")}</th><th>{t("csv.problem")}</th></tr></thead>
            <tbody>{result.errors.map((e, i) => <tr key={i}><td className="num">{e.row}</td><td>{e.message}</td></tr>)}</tbody></table></div>
        ) : <p className="muted small">{t("csv.noErrors")}</p>}
        <div className="btn-group"><Button onClick={() => { setResult(null); setText(""); }}>{t("csv.another")}</Button>{onDone ? <Button variant="primary" onClick={() => onDone(result)}>{t("common.done")}</Button> : null}</div>
      </div>
    );
  }
  return (
    <div className="stack">
      {title ? <h3 style={{ margin: 0 }}>{title}</h3> : null}
      <p className="small muted" style={{ margin: 0 }}>{t("csv.columns")}: <code>{columns.map((c) => c.key + (c.required ? "*" : "")).join(", ")}</code></p>
      <div className={`dropzone${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <IconUpload size={20} style={{ display: "inline", verticalAlign: "-4px", marginRight: 6 }} />{t("csv.drop")}
        <label className="btn sm" style={{ marginLeft: 10 }}>
          {t("csv.chooseFile")}
          <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => readFile(e.target.files?.[0])} />
        </label>
      </div>
      <Field label={t("csv.paste")} hint={t("csv.pasteHint")}>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={sample} spellCheck={false} />
      </Field>
      {parsed.rows.length > 0 ? (
        <div className="csv-preview stack" style={{ gap: 8 }}>
          <div className="row between">
            <strong>{t("csv.preview", { count: parsed.rows.length })}</strong>
            {bad ? <Pill tone="red">{t("csv.problems", { count: bad })}</Pill> : <Pill tone="green">{t("csv.allValid")}</Pill>}
          </div>
          {parsed.unknownHeader ? <div className="banner warn"><IconAlert size={16} /><span>{t("csv.noHeader")}</span></div> : null}
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="table">
              <thead><tr><th>#</th>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {parsed.rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    {columns.map((c) => { const p = parsed.problems.find((x) => x.row === i && x.col === c.key); return <td key={c.key} className={p ? "bad" : undefined} title={p?.msg}>{r[c.key] || (p ? p.msg : "")}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 200 ? <p className="small muted">{t("csv.previewTruncated", { count: parsed.rows.length - 200 })}</p> : null}
          <div className="btn-group">
            <Button variant="primary" disabled={bad > 0} loading={busy} onClick={async () => {
              setBusy(true);
              try { const r = await onImport(text); setResult(r); toast.success(t("csv.imported", { count: r.created + r.updated })); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); }
            }}>{t("csv.import", { count: parsed.rows.length })}</Button>
            {bad ? <span className="small muted" style={{ alignSelf: "center" }}>{t("csv.fixFirst")}</span> : null}
          </div>
        </div>
      ) : text.trim() ? <EmptyState title={t("csv.nothingParsed")} body={t("csv.nothingParsedHint")} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------- owner / user picker */
export function UserPicker({ value, valueName, onChange, siteId, label, required, hint, error, roleHint }: { value: string; valueName?: string; onChange: (id: string, user: UserAdmin | null) => void; siteId?: string | null; label: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode; roleHint?: string }) {
  const { t } = useI18n();
  const { searchUsers } = useScope();
  const [q, setQ] = useState(valueName ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserAdmin[]>([]);
  const [idx, setIdx] = useState(0);
  const dq = useDebounced(q, 250);
  useEffect(() => { if (valueName !== undefined) setQ(valueName); }, [valueName]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    searchUsers(dq, siteId).then((u) => {
      if (!alive) return;
      const sorted = roleHint ? [...u].sort((a, b) => Number(b.roles.some((r) => r.role === roleHint)) - Number(a.roles.some((r) => r.role === roleHint))) : u;
      setItems(sorted); setIdx(0);
    }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [dq, open, siteId, searchUsers, roleHint]);
  const choose = (u: UserAdmin) => { onChange(u.id, u); setQ(u.name); setOpen(false); };
  return (
    <Field label={label} required={required} hint={hint} error={error}>
      <div className="owner-suggest">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); if (value) onChange("", null); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t("picker.userPlaceholder")} autoComplete="off" role="combobox" aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter" && open && items[idx]) { e.preventDefault(); choose(items[idx]); }
          }} />
        {open && items.length > 0 ? (
          <div className="pop" role="listbox">
            {items.map((u, i) => (
              <button key={u.id} type="button" role="option" aria-selected={i === idx} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(u)}>
                <span className="grow truncate">{u.name}</span>
                <span className="m">{u.employeeCode}{u.employerName ? ` · ${u.employerName}` : ""} · {u.roles.slice(0, 2).map((r) => t(`role.${r.role}`)).join(", ")}</span>
              </button>
            ))}
          </div>
        ) : null}
        {open && q && items.length === 0 ? <div className="pop"><div className="small muted" style={{ padding: 8 }}>{t("picker.noUsers")}</div></div> : null}
      </div>
      {value ? <input type="hidden" value={value} readOnly /> : null}
    </Field>
  );
}

/* ------------------------------------------------------------- key/value list */
export function KV({ rows }: { rows: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="dl">
      {rows.map((r, i) => (<div key={i} style={{ display: "contents" }}><dt>{r.k}</dt><dd>{r.v ?? "—"}</dd></div>))}
    </dl>
  );
}

/* ------------------------------------------------------------- reason sheet */
export function ReasonSheet({ title, body, confirmLabel, onConfirm, onClose, danger, extra }: { title: string; body?: ReactNode; confirmLabel: string; onConfirm: (reason: string) => Promise<void>; onClose: () => void; danger?: boolean; extra?: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={title} onClose={onClose} footer={<>
      <Button onClick={onClose}>{t("common.cancel")}</Button>
      <Button variant={danger ? "danger" : "primary"} disabled={reason.trim().length < 3} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); } }}>{confirmLabel}</Button>
    </>}>
      {body ? <p>{body}</p> : null}
      {extra}
      <Field label={t("common.reason")} required hint={t("reason.hint")}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={500} />
      </Field>
    </Sheet>
  );
}

/** Simple async action button with toast on failure. */
export function AsyncButton({ onClick, children, ...rest }: { onClick: () => Promise<void>; children: ReactNode } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return <Button {...rest} loading={busy} onClick={async () => { setBusy(true); try { await onClick(); } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); } }}>{children}</Button>;
}

export function useSiteAreas(siteId: string | null | undefined) {
  const { loadAreas, areasFor } = useScope();
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (siteId) loadAreas(siteId).catch(setErr); }, [siteId, loadAreas]);
  return { areas: siteId ? areasFor(siteId) : [], error: err };
}

export const langOptions = LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }));

export function useCallbackRef<T extends (...a: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...a: any[]) => ref.current(...a)) as T, []);
}
