/* Reports: "My reports" for everyone; officers also get the Triage inbox (critical first, then oldest, SLA countdown)
   and the full site list with filters and search. All from the local store, so it works offline. */
import { useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Band, ObservationStatus, ObservationType } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Chip, ChipBar, EmptyState, ListSkeleton, SearchEmpty, Select, Tabs, useToast } from "../../shared/ui";
import { useDebounced, useLocalState } from "../../shared/hooks";
import { IconPlus, IconFilter } from "../../shared/icons";
import { useSession, isOfficer } from "../session";
import { useObservations, useRefData } from "../offline/store";
import { SyncBanner, ObservationRow, SearchBox, useListKeys, useNow } from "../components/common";
import { countdown, triageDeadline } from "../lib";
import type { LocalObservation } from "../offline/db";

type Tab = "mine" | "triage" | "site";
interface Filters { status: ObservationStatus | ""; type: ObservationType | ""; band: Band | ""; areaId: string; siteId: string; category: string }
const EMPTY_F: Filters = { status: "", type: "", band: "", areaId: "", siteId: "", category: "" };

export default function Reports() {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { me } = useSession();
  const ref = useRefData();
  const { data: observations, loading } = useObservations();
  const officer = isOfficer(me);
  const tab = ((params.get("tab") as Tab) || "mine");
  const setTab = (v: Tab) => { const p = new URLSearchParams(params); p.set("tab", v); setParams(p, { replace: true }); };
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const [f, setF] = useState<Filters>({ ...EMPTY_F, status: (params.get("status") as ObservationStatus) || "" });
  const [savedFilters, setSavedFilters] = useLocalState<{ name: string; f: Filters }[]>(`sw.field.reportFilters.${me?.id ?? "x"}`, []);
  const [showFilters, setShowFilters] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useListKeys(listRef);
  useNow(60_000);
  const sla = me?.org.settings.triageSlaWorkingDays ?? 1;
  const critical = params.get("critical") === "1";
  const catName = (code: string) => pick(ref.categories.find((c) => c.code === code)?.name) || code;

  const rows = useMemo(() => {
    let pool: LocalObservation[] = observations;
    if (tab === "mine") pool = pool.filter((o) => o.mine || o.local);
    else if (tab === "triage") pool = pool.filter((o) => o.status === "submitted" && !o.local && (!critical || o.imminentDanger));
    if (f.status) pool = pool.filter((o) => o.status === f.status);
    if (f.type) pool = pool.filter((o) => o.type === f.type);
    if (f.band) pool = pool.filter((o) => o.riskBand === f.band);
    if (f.siteId) pool = pool.filter((o) => o.siteId === f.siteId);
    if (f.areaId) pool = pool.filter((o) => o.areaId === f.areaId);
    if (f.category) pool = pool.filter((o) => o.categoryCodes.includes(f.category));
    if (dq.trim()) {
      const needle = dq.trim().toLowerCase();
      pool = pool.filter((o) => [o.caseNo, o.description, o.reporterName ?? "", pick(o.areaName), ...o.categoryCodes.map(catName)].join(" ").toLowerCase().includes(needle));
    }
    if (tab === "triage") return [...pool].sort((a, b) => Number(b.imminentDanger) - Number(a.imminentDanger) || a.receivedAt.localeCompare(b.receivedAt));
    return [...pool].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observations, tab, f, dq, critical, ref.categories]);

  const triageCount = observations.filter((o) => o.status === "submitted" && !o.local).length;
  const anyFilter = Object.values(f).some(Boolean) || !!dq;
  const siteAreas = ref.areas.filter((a) => !f.siteId || a.siteId === f.siteId);

  return (
    <div className="page">
      <SyncBanner compact />
      <div className="page-head">
        <h1>{t("nav.reports")}</h1>
        <Button variant="primary" size="sm" onClick={() => nav("/report")}><IconPlus size={18} /> {t("nav.report")}</Button>
      </div>
      {officer ? (
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: "mine", label: t("reports.mine") },
          { value: "triage", label: t("reports.triage"), count: triageCount },
          { value: "site", label: t("reports.site") },
        ]} />
      ) : null}
      <div className="list-head">
        <div className="search-row">
          <SearchBox value={q} onChange={setQ} placeholder={t("reports.searchPlaceholder")} />
          <Button variant={showFilters || anyFilter ? "subtle" : "ghost"} icon onClick={() => setShowFilters((s) => !s)} aria-label={t("common.filter")} aria-expanded={showFilters}><IconFilter /></Button>
        </div>
        {showFilters ? (
          <div className="stack" style={{ marginTop: 8, gap: 8 }}>
            <ChipBar>
              {(["submitted", "returned", "action_assigned", "closed", "discarded", "merged", "escalated"] as ObservationStatus[]).map((s) => <Chip key={s} on={f.status === s} onClick={() => setF({ ...f, status: f.status === s ? "" : s })}>{t(`obs.status.${s}`)}</Chip>)}
            </ChipBar>
            <ChipBar>
              {(["good_practice", "unsafe_act", "unsafe_condition", "near_miss"] as ObservationType[]).map((ty) => <Chip key={ty} on={f.type === ty} onClick={() => setF({ ...f, type: f.type === ty ? "" : ty })}>{t(`type.${ty}`)}</Chip>)}
              {(["extreme", "high", "moderate", "low"] as Band[]).map((b) => <Chip key={b} on={f.band === b} onClick={() => setF({ ...f, band: f.band === b ? "" : b })}>{t(`band.${b}`)}</Chip>)}
            </ChipBar>
            <div className="row">
              {ref.sites.length > 1 ? <Select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value, areaId: "" })} style={{ width: "auto", flex: 1 }}><option value="">{t("common.site")}: {t("common.all")}</option>{ref.sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {pick(s.name)}</option>)}</Select> : null}
              <Select value={f.areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })} style={{ width: "auto", flex: 1 }}><option value="">{t("common.area")}: {t("common.all")}</option>{siteAreas.map((a) => <option key={a.id} value={a.id}>{pick(a.name)}</option>)}</Select>
              <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={{ width: "auto", flex: 1 }}><option value="">{t("common.category")}: {t("common.all")}</option>{ref.categories.filter((c) => c.active).map((c) => <option key={c.code} value={c.code}>{pick(c.name)}</option>)}</Select>
            </div>
            <div className="row">
              {anyFilter ? <Button size="sm" onClick={() => { setF(EMPTY_F); setQ(""); }}>{t("common.clearFilters")}</Button> : null}
              {anyFilter ? <Button size="sm" variant="subtle" onClick={() => { const name = window.prompt(t("reports.saveFilterName")); if (name) setSavedFilters([...savedFilters.filter((s) => s.name !== name), { name, f }]); }}>{t("reports.saveFilter")}</Button> : null}
              {savedFilters.map((s) => (
                <Chip key={s.name} on={JSON.stringify(s.f) === JSON.stringify(f)} onClick={() => setF(s.f)} onContextMenu={(e) => { e.preventDefault(); }}>
                  {s.name}
                  <span role="button" aria-label={t("common.delete")} style={{ marginLeft: 4 }} onClick={(e) => { e.stopPropagation(); const rest = savedFilters.filter((x) => x.name !== s.name); setSavedFilters(rest); toast.undoable(t("reports.filterDeleted", { name: s.name }), () => { /* already removed */ }, () => setSavedFilters([...rest, s])); }}>×</span>
                </Chip>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div ref={listRef}>
        {loading ? <ListSkeleton rows={5} /> : rows.length === 0 ? (
          anyFilter ? <SearchEmpty q={dq || t("common.filter")} onClear={() => { setF(EMPTY_F); setQ(""); }} /> :
          tab === "triage" ? <EmptyState title={t("reports.triageEmpty")} body={t("reports.triageEmptyBody")} /> :
          <EmptyState title={t("reports.empty")} body={t("reports.emptyBody")} action={<Button variant="primary" onClick={() => nav("/report")}><IconPlus size={18} /> {t("nav.report")}</Button>} />
        ) : (
          <div className="list" data-testid="reports-list">
            {rows.map((o) => (
              <div key={o.id}>
                <ObservationRow o={o} catName={catName} />
                {tab === "triage" ? <TriageSla receivedAt={o.receivedAt} siteId={o.siteId} sla={sla} /> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TriageSla({ receivedAt, siteId, sla }: { receivedAt: string; siteId: string; sla: number }) {
  const { t } = useI18n();
  const ref = useRefData();
  const cd = countdown(triageDeadline(receivedAt, ref.sites.find((s) => s.id === siteId), sla), t);
  return <div className={`small sla ${cd.late ? "late" : cd.soon ? "soon" : ""}`} style={{ padding: "2px 12px 0" }}>{t("reports.triageBy")} · {cd.text}</div>;
}
