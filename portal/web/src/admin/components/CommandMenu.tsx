/* Command menu (Ctrl+K or ⌘K), after shadcn-admin: type to go to any console page, or paste a case number to open it.
   Keyboard: ↑/↓ choose, Enter opens, Esc closes. Accessible as a combobox with a listbox of options. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../shared/i18n";
import { IconSearch } from "../../shared/icons";

export interface CommandItem { key: string; label: string; group: string; icon?: ReactNode; to: string; isCase?: boolean }

const CASE_RE = /^[A-Z0-9]{2,6}-(OBS|ACT|INS)-\d{4}-\d{1,6}$/i;

export function CommandMenu({ items, onGo, onCase, onClose }: { items: CommandItem[]; onGo: (to: string) => void; onCase: (q: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // focus the input (again after a page that focuses its own search box), and close on Esc wherever the focus is
    input.current?.focus();
    const t1 = window.setTimeout(() => input.current?.focus(), 60);
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeRef.current(); } };
    window.addEventListener("keydown", onEsc, true);
    return () => { clearTimeout(t1); window.removeEventListener("keydown", onEsc, true); };
  }, []);

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pages = items.filter((i) => !needle || i.label.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle));
    const out: CommandItem[] = [];
    if (CASE_RE.test(q.trim())) out.push({ key: "case", label: t("cmdk.openCase", { case: q.trim().toUpperCase() }), group: t("cmdk.cases"), to: "", isCase: true });
    return [...out, ...pages];
  }, [q, items, t]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.isCase) onCase(q.trim()); else onGo(o.to);
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(options.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let lastGroup = "";
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t("cmdk.title")} data-testid="command-menu">
        <div className="cmdk-input">
          <IconSearch size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t("cmdk.placeholder")}
            role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={options[sel] ? `cmdk-${sel}` : undefined} aria-autocomplete="list" />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmdk-list" id="cmdk-list" role="listbox" ref={list}>
          {options.length === 0 ? <li className="cmdk-empty" role="presentation">{t("cmdk.empty")}</li> : options.flatMap((o, i) => {
            const rows: ReactNode[] = [];
            if (o.group !== lastGroup) rows.push(<li key={`g-${o.group}`} className="cmdk-group" role="presentation">{o.group}</li>);
            lastGroup = o.group;
            rows.push(
              <li key={o.key} id={`cmdk-${i}`} data-i={i} role="option" aria-selected={i === sel} className="cmdk-item" onMouseMove={() => setSel(i)} onClick={() => choose(i)}>
                {o.icon ?? <IconSearch size={16} />}<span>{o.label}</span>
              </li>,
            );
            return rows;
          })}
        </ul>
        <div className="cmdk-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> {t("cmdk.move")}</span><span><kbd>Enter</kbd> {t("cmdk.open")}</span></div>
      </div>
    </>
  );
}
