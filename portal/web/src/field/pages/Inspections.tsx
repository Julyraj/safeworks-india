/* Inspections: the due list by status (overdue, due today, in progress, upcoming, recent), Scan QR, and
   "Start spot inspection" from a template that applies to the site, area or asset. */
import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { TemplateVersion } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Chip, ChipBar, EmptyState, Field, ListSkeleton, Select, Sheet, useToast } from "../../shared/ui";
import { IconQr, IconPlus, IconClipboard } from "../../shared/icons";
import { uuid } from "../../shared/storage";
import { useSession } from "../session";
import { useRefData, useRuns } from "../offline/store";
import { startRun } from "../offline/commands";
import { SyncBanner, RunRow, useListKeys, useNow } from "../components/common";
import { areasOf, docNumber, isToday, readLastLocation, templatesFor } from "../lib";
import type { LocalRun } from "../offline/db";

export default function Inspections() {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { me } = useSession();
  const ref = useRefData();
  const { data: runs, loading } = useRuns();
  const [start, setStart] = useState<{ assetId?: string | null } | null>(params.get("start") ? { assetId: params.get("asset") } : null);
  const [filter, setFilter] = useState<"all" | "mine" | "done">("all");
  const listRef = useRef<HTMLDivElement>(null);
  useListKeys(listRef);
  useNow(60_000);

  const groups = useMemo(() => {
    const now = Date.now();
    let pool: LocalRun[] = runs;
    if (filter === "mine") pool = pool.filter((r) => r.inspectorUserId === me?.id || (!r.inspectorUserId && r.status === "scheduled"));
    if (filter === "done") pool = pool.filter((r) => ["completed", "closed", "reopened"].includes(r.status));
    const g = { overdue: [] as LocalRun[], today: [] as LocalRun[], progress: [] as LocalRun[], upcoming: [] as LocalRun[], recent: [] as LocalRun[], missed: [] as LocalRun[] };
    for (const r of pool) {
      if (r.status === "in_progress") g.progress.push(r);
      else if (r.status === "scheduled") { if (r.dueAt && new Date(r.dueAt).getTime() < now && !isToday(r.dueAt)) g.overdue.push(r); else if (isToday(r.dueAt)) g.today.push(r); else g.upcoming.push(r); }
      else if (r.status === "missed") g.missed.push(r);
      else g.recent.push(r);
    }
    const byDue = (a: LocalRun, b: LocalRun) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
    g.overdue.sort(byDue); g.today.sort(byDue); g.upcoming.sort(byDue); g.progress.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    g.recent.sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
    return g;
  }, [runs, filter, me?.id]);
  const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
  const areaName = (id: string | null) => pick(ref.areas.find((a) => a.id === id)?.name);
  const assetTag = (id: string | null) => ref.assets.find((a) => a.id === id)?.tagNo;

  const Group = ({ title, rows, tone }: { title: string; rows: LocalRun[]; tone?: string }) => rows.length ? (
    <>
      <div className="group-title" style={tone ? { color: tone } : undefined}>{title} · {rows.length}</div>
      <div className="list">{rows.map((r) => <RunRow key={r.id} r={r} areaName={areaName(r.areaId)} assetTag={assetTag(r.assetId)} />)}</div>
    </>
  ) : null;

  return (
    <div className="page">
      <SyncBanner compact />
      <div className="page-head">
        <h1>{t("nav.inspections")}</h1>
        <div className="btn-group">
          <Button onClick={() => nav("/scan")}><IconQr size={18} /> {t("nav.scan")}</Button>
          <Button variant="primary" onClick={() => setStart({})} data-testid="start-inspection"><IconPlus size={18} /> {t("insp.start")}</Button>
        </div>
      </div>
      <ChipBar>
        <Chip on={filter === "all"} onClick={() => setFilter("all")}>{t("common.all")}</Chip>
        <Chip on={filter === "mine"} onClick={() => setFilter("mine")}>{t("insp.mine")}</Chip>
        <Chip on={filter === "done"} onClick={() => setFilter("done")}>{t("insp.done")}</Chip>
      </ChipBar>
      <div ref={listRef}>
        {loading ? <ListSkeleton rows={4} /> : total === 0 ? (
          <EmptyState icon={<IconClipboard />} title={t("insp.empty")} body={t("insp.emptyBody")} action={<Button variant="primary" onClick={() => setStart({})}>{t("insp.start")}</Button>} />
        ) : (
          <>
            <Group title={t("insp.overdue")} rows={groups.overdue} tone="var(--red)" />
            <Group title={t("insp.dueToday")} rows={groups.today} tone="var(--orange)" />
            <Group title={t("insp.inProgress")} rows={groups.progress} />
            <Group title={t("insp.upcoming")} rows={groups.upcoming} />
            <Group title={t("insp.missed")} rows={groups.missed} tone="var(--red)" />
            <Group title={t("insp.recent")} rows={groups.recent} />
          </>
        )}
      </div>
      {start ? <StartSheet assetId={start.assetId ?? null} onClose={() => setStart(null)} /> : null}
    </div>
  );
}

export function StartSheet({ assetId, areaId, onClose }: { assetId: string | null; areaId?: string | null; onClose: () => void }) {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const ref = useRefData();
  const asset = ref.assets.find((a) => a.id === assetId) ?? null;
  const last = me ? readLastLocation(me.id) : null;
  const [siteId, setSiteId] = useState(asset?.siteId ?? last?.siteId ?? me?.sites[0]?.id ?? "");
  const [area, setArea] = useState(asset?.areaId ?? areaId ?? last?.areaId ?? "");
  const [tpl, setTpl] = useState("");
  const [busy, setBusy] = useState(false);
  const site = ref.sites.find((s) => s.id === siteId) ?? null;
  const areas = areasOf(ref, siteId || null);
  const templates = templatesFor(ref, site, areas.find((a) => a.id === area) ?? null, asset?.assetClass ?? null);
  const allTemplates = ref.templates.filter((tv) => tv.status === "active");
  const list: TemplateVersion[] = templates.length ? templates : allTemplates;
  const go = async () => {
    const tv = list.find((x) => x.id === tpl);
    if (!tv || !siteId) return;
    setBusy(true);
    try {
      const clientUuid = uuid();
      const header: Record<string, string> = { site: site?.code ?? "", area: pick(areas.find((a) => a.id === area)?.name), asset: asset?.tagNo ?? "", date: new Date().toISOString().slice(0, 10), inspector: me?.name ?? "", docNo: docNumber(tv.code) };
      await startRun({ clientUuid, templateVersionId: tv.id, siteId, areaId: area || null, assetId: asset?.id ?? null, trigger: "spot", header, startedAt: new Date().toISOString() }, tv, me, `${pick(tv.name)} · ${site?.code ?? ""}`);
      onClose();
      nav(`/inspections/runs/${clientUuid}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={t("insp.start")} onClose={onClose} footer={<><Button onClick={onClose}>{t("common.cancel")}</Button><Button variant="primary" disabled={!tpl || !siteId} loading={busy} onClick={go} data-testid="start-run">{t("insp.begin")}</Button></>}>
      {asset ? <p className="small"><b>{asset.tagNo}</b> · {t(`assetClass.${asset.assetClass}`)} · {asset.makeModel}{asset.status !== "in_service" ? <> · <span style={{ color: "var(--red)", fontWeight: 700 }}>{t(`asset.status.${asset.status}`)}</span></> : null}</p> : null}
      {me && me.sites.length > 1 && !asset ? (
        <Field label={t("common.site")} required><Select value={siteId} onChange={(e) => { setSiteId(e.target.value); setArea(""); setTpl(""); }}>{me.sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {pick(s.name)}</option>)}</Select></Field>
      ) : null}
      {!asset ? (
        <Field label={t("common.area")} optional>
          <ChipBar wrap>{areas.map((a) => <Chip key={a.id} on={area === a.id} onClick={() => { setArea(area === a.id ? "" : a.id); setTpl(""); }}>{pick(a.name)}</Chip>)}</ChipBar>
        </Field>
      ) : null}
      <Field label={t("insp.template")} required hint={templates.length === 0 && allTemplates.length ? t("insp.noMatchShowingAll") : undefined}>
        <div className="list">
          {list.map((tv) => (
            <button key={tv.id} type="button" className="decision-btn" aria-pressed={tpl === tv.id} onClick={() => setTpl(tv.id)} data-testid={`tpl-${tv.code}`}>
              <span><b>{pick(tv.name)}</b> <span className="small muted">v{tv.version} · {tv.sections.reduce((n, s) => n + s.questions.length, 0)} {t("insp.items")}</span></span>
            </button>
          ))}
          {list.length === 0 ? <span className="small muted">{t("insp.noTemplates")}</span> : null}
        </div>
      </Field>
    </Sheet>
  );
}
