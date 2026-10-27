/* Language packs: completeness per language, key table (search, missing first), inline override editing, import/export JSON. */
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useI18n, LANGS, LANG_NAMES } from "../../shared/i18n";
import type { Lang, TranslationPack } from "../../shared/types";
import { Button, Card, EmptyState, ErrorCard, Input, Pill, Progress, Skeleton, Tabs, useToast } from "../../shared/ui";
import { useLoad, useDebounced } from "../../shared/hooks";
import { IconDownload, IconUpload } from "../../shared/icons";
import { api, errMessage, saveBlob } from "../api";
import { useAuth } from "../auth";
import { PageHead } from "../components";
import sharedEn from "../../shared/i18n/shared.en.json";
import sharedHi from "../../shared/i18n/shared.hi.json";
import sharedTa from "../../shared/i18n/shared.ta.json";
import sharedKn from "../../shared/i18n/shared.kn.json";
import adminEn from "../../shared/i18n/admin.en.json";
import adminHi from "../../shared/i18n/admin.hi.json";
import adminTa from "../../shared/i18n/admin.ta.json";
import adminKn from "../../shared/i18n/admin.kn.json";

const LOCAL: Record<Lang, Record<string, string>> = {
  en: { ...sharedEn, ...adminEn }, hi: { ...sharedHi, ...adminHi }, ta: { ...sharedTa, ...adminTa }, kn: { ...sharedKn, ...adminKn },
};

export default function Languages() {
  const { t, setOverrides } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const [lang, setLang] = useState<Lang>("hi");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const [showAll, setShowAll] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const summary = useLoad(async () => { const r = await Promise.all(LANGS.filter((l) => l !== "en").map((l) => api.get<TranslationPack>("/admin/translations", { lang: l }).catch(() => null))); return r; }, []);
  const pack = useLoad(() => api.get<TranslationPack>("/admin/translations", { lang }), [lang]);
  useEffect(() => { setEdits({}); }, [lang]);
  const canEdit = perms.isAdmin && !perms.readOnly;
  const p = pack.data;
  const rows = useMemo(() => {
    const serverKeys = p ? [...p.missing, ...Object.keys(p.overrides)] : [];
    const keys = Array.from(new Set([...Object.keys(LOCAL.en), ...serverKeys])).filter((k) => !k.startsWith("_"));
    const missing = new Set(p?.missing ?? []);
    return keys.map((k) => {
      const base = LOCAL[lang][k] ?? "";
      const override = p?.overrides[k] ?? "";
      const value = edits[k] ?? override;
      const isMissing = missing.has(k) || (!base && !override);
      return { key: k, en: LOCAL.en[k] ?? "", base, override, value, missing: isMissing };
    }).filter((r) => !dq || r.key.toLowerCase().includes(dq.toLowerCase()) || r.en.toLowerCase().includes(dq.toLowerCase()) || r.base.toLowerCase().includes(dq.toLowerCase()))
      .filter((r) => showAll || r.missing || r.override || edits[r.key] !== undefined || dq)
      .sort((a, b) => Number(b.missing) - Number(a.missing) || a.key.localeCompare(b.key));
  }, [p, lang, edits, dq, showAll]);
  const dirty = Object.keys(edits).length;
  const save = async () => {
    if (!p) return;
    setBusy(true);
    try {
      const overrides = { ...p.overrides };
      for (const [k, v] of Object.entries(edits)) { if (v.trim()) overrides[k] = v.trim(); else delete overrides[k]; }
      const saved = await api.put<TranslationPack>(`/admin/translations/${lang}`, { overrides });
      pack.setData(saved ?? { ...p, overrides });
      setEdits({});
      setOverrides({ [lang]: (saved ?? { overrides }).overrides });
      toast.success(t("lang.saved", { n: dirty }));
      summary.reload();
    } catch (e) { toast.error(errMessage(e)); } finally { setBusy(false); }
  };
  const exportJson = async () => {
    try { const blob = await api.download("/admin/translations/export", { lang }); saveBlob(blob, `safeworks-${lang}.json`); } catch { const merged = { _status: LOCAL[lang]._status ?? "", ...LOCAL[lang], ...(p?.overrides ?? {}) }; saveBlob(new Blob([JSON.stringify(merged, null, 2)], { type: "application/json" }), `safeworks-${lang}.json`); }
  };
  const importJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as Record<string, string>;
      const overrides = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => !k.startsWith("_") && typeof v === "string"));
      const saved = await api.post<TranslationPack>("/admin/translations/import", { lang, overrides });
      pack.setData(saved ?? (p ? { ...p, overrides: { ...p.overrides, ...overrides } } : null));
      setOverrides({ [lang]: (saved?.overrides ?? overrides) });
      toast.success(t("lang.imported", { n: Object.keys(overrides).length }));
      summary.reload();
    } catch (er) { toast.error(errMessage(er)); }
    e.target.value = "";
  };
  return (
    <>
      <PageHead title={t("nav.languages")} sub={t("lang.sub")} tools={<>
        <Button size="sm" onClick={exportJson}><IconDownload size={14} />{t("lang.export")}</Button>
        {canEdit ? <label className="btn sm"><IconUpload size={14} />{t("lang.import")}<input type="file" accept="application/json,.json" hidden onChange={importJson} /></label> : null}
      </>} />
      <div className="cmp-grid" style={{ marginBottom: 14 }}>
        {LANGS.filter((l) => l !== "en").map((l, i) => { const s = summary.data?.[i]; const total = s?.total ?? Object.keys(LOCAL.en).length; const done = s ? s.translated : Object.keys(LOCAL.en).filter((k) => LOCAL[l][k]).length; return (
          <Card key={l} onClick={() => setLang(l)} className={lang === l ? "surface-2" : ""}>
            <div className="row between"><strong>{LANG_NAMES[l]}</strong><Pill tone={done >= total ? "green" : "amber"}>{total ? Math.round((done / total) * 100) : 0}%</Pill></div>
            <Progress value={done} max={total} label={LANG_NAMES[l]} />
            <div className="small muted" style={{ marginTop: 4 }}>{t("lang.completeness", { done, total })}{LOCAL[l]._status ? ` · ${LOCAL[l]._status}` : ""}</div>
          </Card>
        ); })}
      </div>
      <Tabs value={lang} onChange={(v) => setLang(v as Lang)} tabs={LANGS.filter((l) => l !== "en").map((l) => ({ value: l, label: LANG_NAMES[l], count: summary.data?.[LANGS.indexOf(l) - 1]?.missing.length }))} />
      <div className="filters" style={{ marginTop: 12 }}>
        <div className="field grow-search"><label>{t("common.search")}</label><Input data-register-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("lang.searchPh")} /></div>
        <div className="end"><Button size="sm" variant={showAll ? "default" : "subtle"} onClick={() => setShowAll((s) => !s)}>{showAll ? t("lang.showMissing") : t("lang.showAll")}</Button></div>
      </div>
      {pack.error && !p ? <ErrorCard error={pack.error} onRetry={pack.reload} /> : null}
      {!p && !pack.error ? <Skeleton lines={8} /> : null}
      {p && rows.length === 0 ? <EmptyState title={t("lang.allDone")} body={t("lang.allDoneHint")} /> : null}
      {p && rows.length ? (
        <div className="table-wrap" style={{ maxHeight: "60vh" }}>
          <table className="table">
            <thead><tr><th>{t("lang.key")}</th><th>English</th><th>{LANG_NAMES[lang]} ({t("lang.pack")})</th><th>{t("lang.override")}</th></tr></thead>
            <tbody>
              {rows.slice(0, 400).map((r) => (
                <tr key={r.key} className="inline-edit">
                  <td className="mono-sm">{r.key}{r.missing ? <Pill tone="red" title={t("lang.missing")}>!</Pill> : null}</td>
                  <td className="small">{r.en}</td>
                  <td className="small">{r.base || <span className="muted">—</span>}</td>
                  <td style={{ minWidth: 220 }}>{canEdit ? <Input value={r.value} onChange={(e) => setEdits((x) => ({ ...x, [r.key]: e.target.value }))} placeholder={r.base || r.en} aria-label={r.key} /> : (r.override || <span className="muted">—</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {rows.length > 400 ? <p className="small muted">{t("csv.previewTruncated", { count: rows.length - 400 })}</p> : null}
      {canEdit ? <div className="sticky-foot"><span className="small muted" style={{ marginRight: "auto", alignSelf: "center" }}>{dirty ? t("lang.pending", { n: dirty }) : t("lang.overridesNote")}</span><Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>{t("common.save")}</Button></div> : null}
    </>
  );
}
