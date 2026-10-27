/* QR manager: codes per site / area / asset, create, rotate (confirm), activate/deactivate, scan counts, print poster (A4/A5, languages). */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n, LANGS, LANG_NAMES } from "../../shared/i18n";
import type { Asset, Lang, QrCode } from "../../shared/types";
import { Button, Confirm, DataTable, EmptyState, ErrorCard, Field, Input, Pill, SearchEmpty, Select, Sheet, Toggle, useToast, type Column } from "../../shared/ui";
import { useLoad } from "../../shared/hooks";
import { relative } from "../../shared/format";
import { IconPlus, IconPrint, IconQr, IconRefresh } from "../../shared/icons";
import { api, asList, errMessage, localCsv, openServerHtml } from "../api";
import { useScope } from "../scope";
import { useAuth } from "../auth";
import { ChipsSelect, Copyable, ExportButton, FilterSelect, PageHead, useSiteAreas } from "../components";

export default function QrCodes() {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const { perms } = useAuth();
  const { siteId, setSiteId, siteName, sites } = useScope();
  const [params, setParams] = useSearchParams();
  const urlSite = params.get("siteId");
  useEffect(() => { if (urlSite) { if (urlSite !== siteId) setSiteId(urlSite); setParams({}, { replace: true }); } }, [urlSite, siteId, setSiteId, setParams]);
  const { areas } = useSiteAreas(siteId);
  const state = useLoad(() => api.get("/admin/qr-codes", { siteId: siteId || undefined }).then((r) => asList<QrCode>(r)), [siteId]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [create, setCreate] = useState(false);
  const [rotate, setRotate] = useState<QrCode | null>(null);
  const [poster, setPoster] = useState<QrCode | null>(null);
  const canEdit = perms.canSiteConfig(siteId || null) && !perms.readOnly;
  const rows = (state.data ?? []).filter((c) => (!type || c.targetType === type) && (!q || `${c.label} ${c.targetName} ${c.token}`.toLowerCase().includes(q.toLowerCase())));
  const patch = (c: QrCode) => state.setData((state.data ?? []).map((x) => (x.id === c.id ? c : x)));
  const columns: Column<QrCode>[] = [
    { key: "label", label: t("qr.label"), render: (c) => <div><div className="cell-title">{c.label || c.targetName}</div><div className="cell-sub">{t(`qr.target.${c.targetType}`)} · {c.targetName}</div></div> },
    { key: "token", label: t("qr.token"), render: (c) => <Copyable value={c.url || c.token} />, width: 260 },
    { key: "scans", label: t("qr.scans"), render: (c) => <div className="nowrap">{c.scanCount}<div className="cell-sub">{c.lastScanAt ? relative(c.lastScanAt, t, lang) : t("qr.neverScanned")}</div></div>, num: true, width: 100 },
    { key: "active", label: t("common.status"), render: (c) => <Pill tone={c.active ? "green" : "grey"}>{c.active ? t("sites.active") : t("sites.inactive")}</Pill>, width: 100 },
    { key: "tools", label: "", render: (c) => (
      <span className="row-actions">
        <Button size="sm" onClick={(e) => { e.stopPropagation(); setPoster(c); }}><IconPrint size={14} />{t("qr.printPoster")}</Button>
        {canEdit ? <><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setRotate(c); }} title={t("qr.rotateHint")}><IconRefresh size={14} />{t("qr.rotate")}</Button>
          <Button size="sm" variant="ghost" onClick={async (e) => { e.stopPropagation(); try { patch(await api.put<QrCode>(`/admin/qr-codes/${c.id}`, { label: c.label, active: !c.active })); toast.success(t("common.saved")); } catch (er) { toast.error(errMessage(er)); } }}>{c.active ? t("qr.deactivate") : t("qr.activate")}</Button></> : null}
      </span>
    ), width: 300 },
  ];
  return (
    <>
      <PageHead title={t("nav.qr")} sub={siteId ? siteName(siteId) : t("top.allSites")} tools={<>
        <ExportButton onExport={async () => localCsv(rows.map((c) => ({ label: c.label, target: c.targetType, target_name: c.targetName, url: c.url, scans: c.scanCount, last_scan: c.lastScanAt ?? "", active: c.active })), "qr-codes.csv")} />
        {canEdit && siteId ? <Button variant="primary" onClick={() => setCreate(true)}><IconPlus size={16} />{t("qr.new")}</Button> : null}
      </>} />
      {!siteId && canEdit ? <div className="banner info" style={{ marginBottom: 12 }}>{t("qr.pickSiteToCreate")}</div> : null}
      <div className="filters">
        <div className="field grow-search"><label>{t("common.search")}</label><Input data-register-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("qr.searchPh")} /></div>
        <FilterSelect label={t("qr.targetType")} value={type} onChange={setType} options={["site", "area", "asset"].map((x) => ({ value: x, label: t(`qr.target.${x}`) }))} />
      </div>
      {state.error && !state.data ? <ErrorCard error={state.error} onRetry={state.reload} /> : null}
      <DataTable columns={columns} rows={rows} rowKey={(c) => c.id} loading={state.loading && !state.data}
        empty={q || type ? <SearchEmpty q={q} onClear={() => { setQ(""); setType(""); }} /> : <EmptyState icon={<IconQr />} title={t("qr.empty")} body={sites.length ? t("qr.emptyHint") : t("sites.emptyHint")} action={canEdit && siteId ? <Button size="sm" variant="primary" onClick={() => setCreate(true)}>{t("qr.new")}</Button> : undefined} />} />
      {create && siteId ? <CreateQrSheet siteId={siteId} areas={areas.map((a) => ({ id: a.id, name: pick(a.name) }))} onClose={() => setCreate(false)} onCreated={(c) => { setCreate(false); state.setData([c, ...(state.data ?? [])]); }} /> : null}
      {rotate ? <Confirm danger title={t("qr.rotateTitle", { label: rotate.label || rotate.targetName })} body={t("qr.rotateBody")} confirmLabel={t("qr.rotate")} reasonRequired reasonLabel={t("common.reason")} onClose={() => setRotate(null)}
        onConfirm={async (reason) => { try { patch(await api.post<QrCode>(`/admin/qr-codes/${rotate.id}/rotate`, { reason })); toast.success(t("qr.rotated")); setRotate(null); } catch (e) { toast.error(errMessage(e)); } }} /> : null}
      {poster ? <PosterSheet code={poster} onClose={() => setPoster(null)} /> : null}
    </>
  );
}

function CreateQrSheet({ siteId, areas, onClose, onCreated }: { siteId: string; areas: { id: string; name: string }[]; onClose: () => void; onCreated: (c: QrCode) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const assets = useLoad(() => api.get("/admin/assets", { siteId }).then((r) => asList<Asset>(r)), [siteId]);
  const [targetType, setTargetType] = useState<QrCode["targetType"]>("area");
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const [anonymousDefault, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const tid = targetType === "site" ? siteId : targetId;
  return (
    <Sheet title={t("qr.new")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!tid} loading={busy} onClick={async () => {
      setBusy(true); setErr("");
      try { onCreated(await api.post<QrCode>("/admin/qr-codes", { targetType, targetId: tid, label, prefill: { anonymous: anonymousDefault } })); toast.success(t("qr.created")); } catch (e) { setErr(errMessage(e)); } finally { setBusy(false); }
    }}>{t("qr.create")}</Button></>}>
      <Field label={t("qr.targetType")}><Select value={targetType} onChange={(e) => { setTargetType(e.target.value as QrCode["targetType"]); setTargetId(""); }}><option value="site">{t("qr.target.site")}</option><option value="area">{t("qr.target.area")}</option><option value="asset">{t("qr.target.asset")}</option></Select></Field>
      {targetType === "area" ? <Field label={t("common.area")} required><Select value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">—</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field> : null}
      {targetType === "asset" ? <Field label={t("common.asset")} required><Select value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">—</option>{(assets.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.tagNo} · {t(`asset.${a.assetClass}`)}</option>)}</Select></Field> : null}
      <Field label={t("qr.label")} optional hint={t("qr.labelHint")}><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></Field>
      <Toggle label={t("qr.prefillAnonymous")} hint={t("qr.prefillAnonymousHint")} checked={anonymousDefault} onChange={setAnon} />
      {err ? <div className="error-card"><p style={{ margin: 0 }}>{err}</p></div> : null}
    </Sheet>
  );
}

function PosterSheet({ code, onClose }: { code: QrCode; onClose: () => void }) {
  const { t } = useI18n();
  const [size, setSize] = useState<"A4" | "A5">("A4");
  const [langs, setLangs] = useState<Lang[]>(["en", "hi", "ta", "kn"]);
  return (
    <Sheet title={`${t("qr.printPoster")} · ${code.label || code.targetName}`} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.close")}</Button><Button variant="primary" disabled={langs.length === 0} onClick={() => { openServerHtml(`/admin/qr-codes/${code.id}/poster`, { lang: langs.join(","), size }); onClose(); }}><IconPrint size={16} />{t("qr.openPoster")}</Button></>}>
      <p className="small muted">{t("qr.posterHint")}</p>
      <Field label={t("qr.size")}><Select value={size} onChange={(e) => setSize(e.target.value as "A4" | "A5")}><option value="A4">A4</option><option value="A5">A5</option></Select></Field>
      <Field label={t("qr.languages")}><ChipsSelect ariaLabel={t("qr.languages")} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} value={langs} onChange={(v) => setLangs(LANGS.filter((l) => v.includes(l)))} /></Field>
    </Sheet>
  );
}
