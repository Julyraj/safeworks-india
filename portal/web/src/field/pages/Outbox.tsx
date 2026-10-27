/* Outbox (brief §15.4): one row per command with type, title, time, status chip, photo progress and the failure reason;
   Sync now, Retry, Fix and resend, Export diagnostics, clear synced (undoable). Synced items stay for 7 days. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../shared/i18n";
import { Button, EmptyState, Pill, Progress, useToast } from "../../shared/ui";
import { IconRefresh, IconDownload, IconTrash, IconEdit, IconCheckCircle, IconWifiOff } from "../../shared/icons";
import { fmtDateTime, fmtTime } from "../../shared/format";
import { copyText, deviceId } from "../../shared/storage";
import { useSession } from "../session";
import { useMediaMeta, useOutbox } from "../offline/store";
import { retryFailed, syncLog, useSync, nextDelay } from "../offline/sync";
import { deleteOutbox, getMeta, storageEstimate, type OutboxItem } from "../offline/db";
import { outboxStatusTone, useNow } from "../components/common";
import { APP_VERSION } from "../api";
import { deviceInfo } from "../lib";

const KEEP_MS = 7 * 86_400_000;

export default function Outbox() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const sync = useSync();
  const { data: items, loading } = useOutbox();
  const media = useMediaMeta();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useNow(15_000);

  const rows = useMemo(() => {
    const cutoff = Date.now() - KEEP_MS;
    return items.filter((x) => !hidden.has(x.commandId) && (x.status !== "synced" || new Date(x.syncedAt ?? x.createdAt).getTime() > cutoff)).sort((a, b) => b.seq - a.seq);
  }, [items, hidden]);
  const synced = rows.filter((x) => x.status === "synced");
  const photosOf = (it: OutboxItem) => media.filter((m) => m.commandId === it.commandId);

  const clearSynced = () => {
    const ids = synced.map((x) => x.commandId);
    setHidden(new Set([...hidden, ...ids]));
    toast.undoable(t("outbox.clearedSynced", { count: ids.length }), () => deleteOutbox(ids), () => setHidden((h) => { const n = new Set(h); ids.forEach((i) => n.delete(i)); return n; }));
  };
  const exportDiagnostics = async () => {
    const est = await storageEstimate();
    const cursor = await getMeta<string>("cursor", "");
    const diag = {
      app: `SafeWorks field ${APP_VERSION}`, at: new Date().toISOString(), user: me ? { id: me.id, code: me.employeeCode, roles: me.roles.map((r) => `${r.role}@${r.siteId ?? "*"}`) } : null, device: { id: deviceId(), ...deviceInfo() },
      storage: est, sync: { online: sync.online, pending: sync.pending, failed: sync.failed, lastSyncedAt: sync.lastSyncedAt, cursor, lastError: sync.lastError },
      outbox: rows.map((x) => ({ seq: x.seq, op: `${x.entityType}.${x.op}`, status: x.status, attempts: x.attempts, error: x.lastError, code: x.lastErrorCode, createdAt: x.createdAt, media: photosOf(x).map((m) => `${m.ref.kind}:${m.status}:${Math.round(m.ref.bytes / 1024)}KB`) })),
      log: syncLog(),
    };
    const text = JSON.stringify(diag, null, 2);
    const file = new File([text], `safeworks-diagnostics-${Date.now()}.json`, { type: "application/json" });
    try {
      if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ title: "SafeWorks diagnostics", files: [file] }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    if (await copyText(text)) toast.success(t("outbox.diagCopied"));
    else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>{t("nav.outbox")}</h1>
          <div className="small muted">{!sync.online ? <><IconWifiOff size={13} /> {t("sync.offline")} · </> : null}{sync.lastSyncedAt ? t("sync.lastSynced", { time: fmtTime(sync.lastSyncedAt, lang) }) : t("sync.never")}{sync.uploads.total ? ` · ${t("sync.photosUploading", { done: sync.uploads.done, total: sync.uploads.total })}` : ""}</div>
        </div>
        <Button variant="primary" onClick={() => void sync.syncNow()} loading={sync.syncing} data-testid="sync-now"><IconRefresh size={18} /> {t("sync.now")}</Button>
      </div>
      <div className="btn-group" style={{ marginBottom: 12 }}>
        {sync.failed ? <Button size="sm" onClick={() => void retryFailed()}>{t("outbox.retryAll")}</Button> : null}
        <Button size="sm" onClick={exportDiagnostics}><IconDownload size={16} /> {t("outbox.exportDiag")}</Button>
        {synced.length ? <Button size="sm" variant="ghost" onClick={clearSynced}><IconTrash size={16} /> {t("outbox.clearSynced")}</Button> : null}
      </div>
      {sync.lastError && (sync.pending || sync.failed) ? <div className="banner warn" style={{ marginBottom: 10 }}><span>{sync.lastError}</span></div> : null}
      {loading ? null : rows.length === 0 ? (
        <EmptyState icon={<IconCheckCircle />} title={t("outbox.empty")} body={t("outbox.emptyBody")} />
      ) : (
        <div className="stack" data-testid="outbox-list">
          {rows.map((it) => {
            const ph = photosOf(it);
            const up = ph.filter((m) => m.status === "uploaded").length;
            const retryIn = it.status === "pending" && it.nextAttemptAt && it.nextAttemptAt > Date.now() ? Math.max(1, Math.round((it.nextAttemptAt - Date.now()) / 1000)) : null;
            return (
              <div key={it.commandId} className={`ob-row ${it.status}`} data-status={it.status}>
                <div>
                  <div className="k">{t(`outbox.op.${it.entityType}.${it.op}`)}</div>
                  <div style={{ fontWeight: 600 }}>{it.title}</div>
                  <div className="small muted">{fmtDateTime(it.createdAt, lang)}{it.caseNo ? ` · ${it.caseNo}` : ""}{it.attempts ? ` · ${t("outbox.attempts", { count: it.attempts })}` : ""}{retryIn ? ` · ${t("outbox.retryIn", { s: retryIn })}` : ""}</div>
                  {ph.length ? <div className="row" style={{ marginTop: 6, gap: 8 }}><Progress value={up} max={ph.length} /><span className="small muted" style={{ whiteSpace: "nowrap" }}>{t("sync.photosUploading", { done: up, total: ph.length })}</span></div> : null}
                </div>
                <Pill tone={outboxStatusTone(it.status)} dot>{t(`sync.status.${it.status}`)}</Pill>
                {it.lastError && it.status !== "synced" ? <div className="err">{it.lastError}{it.lastErrorCode ? ` (${it.lastErrorCode})` : ""}{ph.some((m) => m.status === "failed") ? ` · ${ph.filter((m) => m.status === "failed").map((m) => m.lastError).join("; ")}` : ""}</div> : null}
                {it.status === "conflict" ? <div className="err" style={{ background: "var(--amber-tint)", color: "var(--ink)" }}>{t("outbox.conflictHint")}</div> : null}
                {it.status === "failed" || it.status === "conflict" || (it.status === "pending" && it.attempts > 0) ? (
                  <div className="acts">
                    {it.status === "failed" ? <Button size="sm" onClick={() => void retryFailed([it.commandId])}><IconRefresh size={14} /> {t("common.retry")}</Button> : null}
                    {it.fixRoute && it.status === "failed" ? <Button size="sm" variant="primary" onClick={() => nav(it.fixRoute!.endsWith("=") ? it.fixRoute + it.commandId : it.fixRoute!)}><IconEdit size={14} /> {t("outbox.fixResend")}</Button> : null}
                    {it.status === "conflict" && it.fixRoute ? <Button size="sm" onClick={() => nav(it.fixRoute!)}>{t("common.open")}</Button> : null}
                    {it.status === "failed" || it.status === "conflict" ? <Button size="sm" variant="ghost" onClick={() => { setHidden(new Set([...hidden, it.commandId])); toast.undoable(t("outbox.removed"), () => deleteOutbox([it.commandId]), () => setHidden((h) => { const n = new Set(h); n.delete(it.commandId); return n; })); }}><IconTrash size={14} /> {t("common.remove")}</Button> : null}
                    {it.status === "pending" && it.attempts > 0 ? <span className="small muted">{t("outbox.backoff", { s: Math.round(nextDelay(it.attempts) / 1000) })}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
