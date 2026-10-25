/* Home: the big Report button, "Needs you now" cards computed from the pulled data, "This week in your area",
   and the sync state. Everything here is local-first, so it renders instantly offline. */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import { Button, Card, CardHead, Bars, ListSkeleton } from "../../shared/ui";
import { IconPlus, IconAlert, IconClock, IconCheckCircle, IconInbox, IconClipboard, IconQr, IconRefresh } from "../../shared/icons";
import { fmtTime } from "../../shared/format";
import { useSession, isOfficer, isVerifier } from "../session";
import { useActions, useObservations, useRefData, useRuns } from "../offline/store";
import { useSync } from "../offline/sync";
import { SyncBanner, ObservationRow, ActionRow, useNow } from "../components/common";
import { countdown, isToday, readLastLocation, triageDeadline } from "../lib";

export default function Home() {
  const { t, lang, pick } = useI18n();
  const nav = useNavigate();
  const { me } = useSession();
  const ref = useRefData();
  const { data: observations, loading: lo } = useObservations();
  const { data: actions, loading: la } = useActions();
  const { data: runs } = useRuns();
  const sync = useSync();
  useNow(60_000);
  const officer = isOfficer(me);
  const verifier = isVerifier(me);
  const sla = me?.org.settings.triageSlaWorkingDays ?? 1;

  const needs = useMemo(() => {
    const myId = me?.id;
    const openStatuses = ["open", "in_progress", "reopened", "disputed"];
    const critical = officer ? observations.filter((o) => o.imminentDanger && !o.criticalAckedAt && o.status !== "closed" && o.status !== "discarded" && !o.local) : [];
    const mine = actions.filter((a) => a.ownerUserId === myId && openStatuses.includes(a.status));
    const overdue = mine.filter((a) => a.overdue);
    const dueToday = mine.filter((a) => !a.overdue && isToday(a.dueAt));
    const toVerify = verifier ? actions.filter((a) => a.status === "completed" && a.ownerUserId !== myId) : [];
    const triage = officer ? observations.filter((o) => o.status === "submitted" && !o.local) : [];
    let triageLate = 0, triageSoonest: Date | null = null;
    for (const o of triage) {
      const d = triageDeadline(o.receivedAt, ref.sites.find((s) => s.id === o.siteId), sla);
      if (d.getTime() < Date.now()) triageLate++;
      if (!triageSoonest || d < triageSoonest) triageSoonest = d;
    }
    const inspections = runs.filter((r) => (r.status === "scheduled" || r.status === "in_progress") && (!r.inspectorUserId || r.inspectorUserId === myId) && (!r.dueAt || new Date(r.dueAt).getTime() < Date.now() + 86_400_000));
    const returned = observations.filter((o) => o.status === "returned" && o.mine);
    return { critical, overdue, dueToday, toVerify, triage, triageLate, triageSoonest, inspections, returned, mine };
  }, [observations, actions, runs, me?.id, officer, verifier, ref.sites, sla]);

  const week = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    const last = me ? readLastLocation(me.id) : null;
    const siteId = last?.siteId ?? me?.sites[0]?.id ?? null;
    const areaId = last?.areaId ?? null;
    const pool = observations.filter((o) => new Date(o.capturedAt).getTime() >= since && (areaId ? o.areaId === areaId : o.siteId === siteId));
    const scope = areaId ? pick(ref.areas.find((a) => a.id === areaId)?.name) : pick(ref.sites.find((s) => s.id === siteId)?.name);
    const byCat = new Map<string, number>();
    for (const o of pool) for (const c of o.categoryCodes) byCat.set(c, (byCat.get(c) ?? 0) + 1);
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([code, n]) => ({ label: pick(ref.categories.find((c) => c.code === code)?.name) || code, n }));
    const repeats = [...byCat.entries()].filter(([, n]) => n >= 2).map(([code]) => pick(ref.categories.find((c) => c.code === code)?.name) || code);
    const atRisk = pool.filter((o) => o.type !== "good_practice").length;
    const good = pool.length - atRisk;
    const repeatRuns = runs.filter((r) => new Date(r.updatedAt).getTime() >= since && r.result === "fail" && (areaId ? r.areaId === areaId : r.siteId === siteId)).length;
    return { scope, total: pool.length, atRisk, good, top, repeats, repeatRuns };
  }, [observations, runs, ref, me, pick]);

  const cards: { key: string; cls: string; n: number; title: string; sub: string; icon: JSX.Element; to: string }[] = [];
  if (needs.critical.length) cards.push({ key: "critical", cls: "critical", n: needs.critical.length, title: t("home.critical"), sub: t("home.criticalSub", { minutes: me?.org.settings.criticalAckMinutes ?? 30 }), icon: <IconAlert />, to: "/reports?tab=triage&critical=1" });
  if (needs.overdue.length) cards.push({ key: "overdue", cls: "overdue", n: needs.overdue.length, title: t("home.overdue"), sub: t("home.overdueSub"), icon: <IconClock />, to: "/actions?tab=mine" });
  if (needs.dueToday.length) cards.push({ key: "today", cls: "overdue", n: needs.dueToday.length, title: t("home.dueToday"), sub: t("home.dueTodaySub"), icon: <IconClock />, to: "/actions?tab=mine" });
  if (needs.toVerify.length) cards.push({ key: "verify", cls: "verify", n: needs.toVerify.length, title: t("home.verify"), sub: t("home.verifySub"), icon: <IconCheckCircle />, to: "/actions?tab=verify" });
  if (needs.triage.length) {
    const cd = needs.triageSoonest ? countdown(needs.triageSoonest, t) : null;
    cards.push({ key: "triage", cls: "triage", n: needs.triage.length, title: t("home.triage"), sub: needs.triageLate ? t("home.triageLate", { count: needs.triageLate }) : cd ? t("home.triageSla", { time: cd.text }) : t("home.triageSub"), icon: <IconInbox />, to: "/reports?tab=triage" });
  }
  if (needs.inspections.length) cards.push({ key: "insp", cls: "inspect", n: needs.inspections.length, title: t("home.inspections"), sub: t("home.inspectionsSub"), icon: <IconClipboard />, to: "/inspections" });
  if (needs.returned.length) cards.push({ key: "returned", cls: "triage", n: needs.returned.length, title: t("home.returned"), sub: t("home.returnedSub"), icon: <IconInbox />, to: "/reports?tab=mine&status=returned" });

  const recentMine = observations.filter((o) => o.mine).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 3);
  const myNext = needs.mine.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 3);
  const catName = (code: string) => pick(ref.categories.find((c) => c.code === code)?.name) || code;

  return (
    <div className="page">
      <SyncBanner />
      <div className="home-hero">
        <div className="row between">
          <div>
            <div className="kicker">{t("home.hello", { name: me?.name.split(" ")[0] ?? "" })}</div>
            <h1 style={{ fontSize: 26 }}>{t("home.headline")}</h1>
          </div>
          <Button variant="ghost" icon onClick={() => nav("/scan")} aria-label={t("nav.scan")}><IconQr /></Button>
        </div>
        <Button variant="primary" block className="home-report" onClick={() => nav("/report")} data-testid="home-report"><IconPlus size={26} /> {t("home.report")}</Button>
      </div>

      <section aria-labelledby="needs-h">
        <h2 id="needs-h" style={{ fontSize: 18 }}>{t("home.needsYou")}</h2>
        {lo || la ? <ListSkeleton rows={2} /> : cards.length === 0 ? (
          <div className="calm"><IconCheckCircle /> <span>{t("home.allClear")}</span></div>
        ) : (
          <div className="needs" data-testid="needs-you">
            {cards.map((c) => (
              <Card key={c.key} className={`need-card ${c.cls}`} onClick={() => nav(c.to)}>
                <span className="ico">{c.icon}</span>
                <span><span className="t">{c.title}</span><br /><span className="s">{c.sub}</span></span>
                <span className="n">{c.n}</span>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: 18 }} aria-labelledby="week-h">
        <h2 id="week-h" style={{ fontSize: 18 }}>{t("home.thisWeek", { scope: week.scope || t("common.site") })}</h2>
        <div className="week">
          <Card>
            <CardHead title={t("home.topCategories")} kicker={t("home.reportsCount", { count: week.total })} />
            {week.top.length ? <Bars rows={week.top} /> : <p className="small muted">{t("home.noReportsWeek")}</p>}
            <p className="small muted" style={{ marginTop: 8 }}>{t("home.riskSplit", { atRisk: week.atRisk, good: week.good })}</p>
          </Card>
          <Card>
            <CardHead title={t("home.repeat")} />
            {week.repeats.length || week.repeatRuns ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {week.repeats.map((r) => <li key={r}>{t("home.repeatCat", { name: r })}</li>)}
                {week.repeatRuns ? <li>{t("home.repeatRuns", { count: week.repeatRuns })}</li> : null}
              </ul>
            ) : <p className="small muted">{t("home.noRepeat")}</p>}
          </Card>
        </div>
      </section>

      {myNext.length ? (
        <section style={{ marginTop: 18 }}>
          <div className="row between"><h2 style={{ fontSize: 18 }}>{t("home.myActions")}</h2><Button size="sm" variant="ghost" onClick={() => nav("/actions")}>{t("common.all")}</Button></div>
          <div className="list">{myNext.map((a) => <ActionRow key={a.id} a={a} />)}</div>
        </section>
      ) : null}
      {recentMine.length ? (
        <section style={{ marginTop: 18 }}>
          <div className="row between"><h2 style={{ fontSize: 18 }}>{t("home.myReports")}</h2><Button size="sm" variant="ghost" onClick={() => nav("/reports")}>{t("common.all")}</Button></div>
          <div className="list">{recentMine.map((o) => <ObservationRow key={o.id} o={o} catName={catName} />)}</div>
        </section>
      ) : null}

      <p className="small muted" style={{ marginTop: 20 }}>
        <IconRefresh size={13} /> {sync.lastSyncedAt ? t("sync.lastSynced", { time: fmtTime(sync.lastSyncedAt, lang) }) : t("sync.never")}
        {" · "}<button type="button" className="btn ghost sm" onClick={() => void sync.syncNow()} disabled={sync.syncing}>{t("sync.now")}</button>
      </p>
    </div>
  );
}
