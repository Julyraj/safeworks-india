/* Actions: Mine (overdue first), To verify (completed actions I did not own), Department (2.1: everything assigned to my
   department, read-only unless it is mine), Site (officers) — with search and filters. The Department tab merges the
   offline copy with a fresh server list when online, so it also shows assignments made before this phone last synced. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ActionStatus, ActionSummary, Band, Paged } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Chip, ChipBar, EmptyState, ListSkeleton, SearchEmpty, Tabs } from "../../shared/ui";
import { useDebounced } from "../../shared/hooks";
import { IconCheckCircle } from "../../shared/icons";
import { useSession, isOfficer, isVerifier } from "../session";
import { api, useActions, useRefData } from "../offline/store";
import { useSync } from "../offline/sync";
import { SyncBanner, ActionRow, SearchBox, useListKeys, useNow } from "../components/common";
import type { LocalAction } from "../offline/db";

type Tab = "mine" | "verify" | "department" | "site";
const OPEN: ActionStatus[] = ["open", "in_progress", "reopened", "disputed"];

export default function Actions() {
  const { t, pick } = useI18n();
  const [params, setParams] = useSearchParams();
  const { me } = useSession();
  const ref = useRefData();
  const { data: actions, loading } = useActions();
  const officer = isOfficer(me);
  const verifier = isVerifier(me);
  const tab = ((params.get("tab") as Tab) || "mine");
  const setTab = (v: Tab) => { const p = new URLSearchParams(params); p.set("tab", v); setParams(p, { replace: true }); };
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const [status, setStatus] = useState<ActionStatus | "open" | "">("");
  const [band, setBand] = useState<Band | "">("");
  const listRef = useRef<HTMLDivElement>(null);
  useListKeys(listRef);
  useNow(60_000);
  const deptId = me?.departmentId ?? null;
  const online = useSync().online;
  const [remote, setRemote] = useState<ActionSummary[]>([]);
  useEffect(() => {
    if (tab !== "department" || !deptId || !online) return;
    let live = true;
    api.get<Paged<ActionSummary>>("/actions", { department: "1", pageSize: 200 }).then((r) => { if (live) setRemote(r.items); }).catch(() => { /* offline copy only */ });
    return () => { live = false; };
  }, [tab, deptId, online]);

  const rows = useMemo(() => {
    let pool: LocalAction[] = actions;
    if (tab === "mine") pool = pool.filter((a) => a.ownerUserId === me?.id);
    else if (tab === "verify") pool = pool.filter((a) => a.status === "completed" && a.ownerUserId !== me?.id);
    else if (tab === "department") {
      const local = pool.filter((a) => deptId && a.departmentId === deptId);
      const seen = new Set(local.map((a) => a.id));
      pool = [...local, ...remote.filter((a) => !seen.has(a.id))];
    }
    if (status === "open") pool = pool.filter((a) => OPEN.includes(a.status));
    else if (status) pool = pool.filter((a) => a.status === status);
    if (band) pool = pool.filter((a) => a.band === band);
    if (dq.trim()) {
      const n = dq.trim().toLowerCase();
      pool = pool.filter((a) => [a.caseNo, a.title, a.ownerName, a.sourceCaseNo ?? "", pick(ref.areas.find((x) => x.id === a.areaId)?.name)].join(" ").toLowerCase().includes(n));
    }
    const rank = (a: LocalAction) => (a.overdue && OPEN.includes(a.status) ? 0 : OPEN.includes(a.status) ? 1 : a.status === "completed" ? 2 : 3);
    return [...pool].sort((a, b) => rank(a) - rank(b) || a.dueAt.localeCompare(b.dueAt));
  }, [actions, tab, me?.id, status, band, dq, ref.areas, pick, deptId, remote]);

  const counts = {
    mine: actions.filter((a) => a.ownerUserId === me?.id && OPEN.includes(a.status)).length,
    verify: actions.filter((a) => a.status === "completed" && a.ownerUserId !== me?.id).length,
  };
  const anyFilter = !!status || !!band || !!dq;
  const tabs: { value: Tab; label: string; count?: number }[] = [{ value: "mine", label: t("actions.mine"), count: counts.mine }];
  if (verifier) tabs.push({ value: "verify", label: t("actions.verify"), count: counts.verify });
  if (deptId) tabs.push({ value: "department", label: t("actions.department") });
  if (officer) tabs.push({ value: "site", label: t("actions.site") });

  return (
    <div className="page">
      <SyncBanner compact />
      <div className="page-head"><h1>{t("nav.actions")}</h1></div>
      {tabs.length > 1 ? <Tabs value={tab} onChange={setTab} tabs={tabs} /> : null}
      <div className="list-head">
        <div className="search-row"><SearchBox value={q} onChange={setQ} placeholder={t("actions.searchPlaceholder")} /></div>
        <ChipBar>
          <Chip on={status === "open"} onClick={() => setStatus(status === "open" ? "" : "open")}>{t("actions.openOnly")}</Chip>
          {(["completed", "verified", "reopened", "disputed", "cancelled"] as ActionStatus[]).map((s) => <Chip key={s} on={status === s} onClick={() => setStatus(status === s ? "" : s)}>{t(`action.status.${s}`)}</Chip>)}
          {(["extreme", "high", "moderate", "low"] as Band[]).map((b) => <Chip key={b} on={band === b} onClick={() => setBand(band === b ? "" : b)}>{t(`band.${b}`)}</Chip>)}
        </ChipBar>
      </div>
      <div ref={listRef}>
        {loading ? <ListSkeleton rows={5} /> : rows.length === 0 ? (
          anyFilter ? <SearchEmpty q={dq || t("common.filter")} onClear={() => { setQ(""); setStatus(""); setBand(""); }} /> :
          tab === "verify" ? <EmptyState icon={<IconCheckCircle />} title={t("actions.verifyEmpty")} body={t("actions.verifyEmptyBody")} /> :
          <EmptyState icon={<IconCheckCircle />} title={t("actions.empty")} body={tab === "mine" ? t("actions.emptyBodyMine") : tab === "department" ? t("actions.emptyBodyDepartment") : t("actions.emptyBodySite")} />
        ) : (
          <div className="list" data-testid="actions-list">
            {rows.map((a) => <ActionRow key={a.id} a={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
