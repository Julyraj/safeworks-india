/* Settings: language, notification and digest preferences, privacy notice + acknowledgement, report a problem
   (diagnostics into a mailto / copy), server address on the native app, theme, about. */
import { useEffect, useState } from "react";
import type { Lang, Preferences } from "../../shared/types";
import { useI18n, LANG_NAMES } from "../../shared/i18n";
import { Button, Card, CardHead, Field, Select, Sheet, Toggle, useToast, Pill } from "../../shared/ui";
import { IconLogout, IconShield, IconSend, IconCopy, IconSun, IconMoon, IconInfo } from "../../shared/icons";
import { errorKey, isNative, serverBase } from "../../shared/api";
import { copyText, deviceId, safeGet, safeSet } from "../../shared/storage";
import { fmtDate } from "../../shared/format";
import { useSession } from "../session";
import { useRefData } from "../offline/store";
import { syncLog, useSync } from "../offline/sync";
import { storageEstimate } from "../offline/db";
import { LangGrid, useOnlineOnly } from "../components/common";
import ServerAddress from "./ServerAddress";
import { APP_VERSION } from "../api";
import { deviceInfo } from "../lib";

const THEME_KEY = "sw.theme";
export function applyTheme(v: string | null) {
  if (v === "dark" || v === "light") document.documentElement.setAttribute("data-theme", v);
  else document.documentElement.removeAttribute("data-theme");
}

export default function Settings({ onLogout }: { onLogout: () => void }) {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const { me, savePreferences, ackPrivacy } = useSession();
  const ref = useRefData();
  const sync = useSync();
  const { online } = useOnlineOnly();
  const [digest, setDigest] = useState<Preferences["digest"]>("daily");
  const [quiet, setQuiet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(false);
  const [problem, setProblem] = useState(false);
  const [theme, setTheme] = useState<string>(safeGet(THEME_KEY) ?? "auto");
  useEffect(() => { applyTheme(theme === "auto" ? null : theme); safeSet(THEME_KEY, theme === "auto" ? null : theme); }, [theme]);
  const needsAck = !!me && me.privacyAckedVersion !== me.privacyNoticeVersion;
  const noticeBody = ref.privacyNotice?.body?.[lang] ?? ref.privacyNotice?.body?.en ?? "";

  const save = async (p: Partial<Preferences>) => {
    setBusy(true);
    try { await savePreferences({ language: lang, digest, quietHours: quiet, ...p }); toast.success(t("common.saved")); }
    catch (e) { const { key, message } = errorKey(e); toast.error(key === "error.generic" ? message : t(key)); }
    finally { setBusy(false); }
  };
  const changeLang = (l: Lang) => { setLang(l); if (online) void save({ language: l }); };

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head"><h1>{t("nav.settings")}</h1></div>
      <Card>
        <CardHead title={t("common.language")} />
        <LangGrid value={lang} onChange={changeLang} />
        <p className="small muted" style={{ margin: "8px 0 0" }}>{t("settings.langHint", { name: LANG_NAMES[lang] })}</p>
      </Card>
      <Card style={{ marginTop: 12 }}>
        <CardHead title={t("settings.appearance")} />
        <div className="segmented" role="group" aria-label={t("settings.appearance")}>
          {(["auto", "light", "dark"] as const).map((v) => <button key={v} type="button" aria-pressed={theme === v} onClick={() => setTheme(v)}>{v === "light" ? <IconSun size={16} /> : v === "dark" ? <IconMoon size={16} /> : null} {t(`settings.theme.${v}`)}</button>)}
        </div>
      </Card>
      <Card style={{ marginTop: 12 }}>
        <CardHead title={t("settings.notifications")} />
        <Field label={t("settings.digest")} hint={t("settings.digestHint")}>
          <Select value={digest} onChange={(e) => setDigest(e.target.value as Preferences["digest"])}>
            <option value="daily">{t("settings.digest.daily")}</option><option value="weekly">{t("settings.digest.weekly")}</option><option value="off">{t("settings.digest.off")}</option>
          </Select>
        </Field>
        <Toggle label={t("settings.quietHours")} hint={t("settings.quietHint", { start: me?.org.settings.quietHours.start ?? "21:00", end: me?.org.settings.quietHours.end ?? "07:00" })} checked={quiet} onChange={setQuiet} />
        <p className="small muted">{t("settings.capHint", { cap: me?.org.settings.dailyPushCap ?? 5 })}</p>
        <Button variant="primary" size="sm" loading={busy} disabled={!online} title={online ? undefined : t("common.needsConnection")} onClick={() => save({})}>{t("common.save")}</Button>
      </Card>
      <Card style={{ marginTop: 12 }}>
        <CardHead title={<span className="row" style={{ gap: 6 }}><IconShield size={18} /> {t("privacy.title")}</span>} action={needsAck ? <Pill tone="amber">{t("settings.ackNeeded")}</Pill> : <Pill tone="green">{t("settings.acked", { version: me?.privacyAckedVersion ?? "" })}</Pill>} />
        <p className="small">{t("settings.privacyBody")}</p>
        <div className="btn-group">
          <Button size="sm" onClick={() => setNotice(true)}>{t("settings.readNotice")}</Button>
          {needsAck ? <Button size="sm" variant="primary" disabled={!online} title={online ? undefined : t("common.needsConnection")} onClick={async () => { try { await ackPrivacy(me!.privacyNoticeVersion); toast.success(t("common.saved")); } catch (e) { toast.error(errorKey(e).message); } }}>{t("privacy.ack")}</Button> : null}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>{t("privacy.contact")}: {me?.org.name}</p>
      </Card>
      {isNative ? (
        <Card style={{ marginTop: 12 }}>
          <CardHead title={t("server.address")} kicker={serverBase()} />
          <ServerAddress embedded onSaved={() => toast.success(t("common.saved"))} />
        </Card>
      ) : null}
      <Card style={{ marginTop: 12 }}>
        <CardHead title={t("settings.problem")} />
        <p className="small">{t("settings.problemBody")}</p>
        <Button size="sm" onClick={() => setProblem(true)}><IconSend size={16} /> {t("settings.reportProblem")}</Button>
      </Card>
      <Card style={{ marginTop: 12 }}>
        <CardHead title={<span className="row" style={{ gap: 6 }}><IconInfo size={18} /> {t("settings.about")}</span>} />
        <dl className="kv">
          <dt>{t("settings.version")}</dt><dd>{APP_VERSION}{isNative ? ` · Android` : " · PWA"}</dd>
          <dt>{t("settings.user")}</dt><dd>{me?.name} · {me?.employeeCode} · {me?.roles.map((r) => t(`role.${r.role}`)).join(", ")}</dd>
          <dt>{t("settings.device")}</dt><dd className="mono small">{deviceId()}</dd>
          <dt>{t("sync.lastSynced", { time: "" }).trim()}</dt><dd>{sync.lastSyncedAt ? fmtDate(sync.lastSyncedAt, lang) : t("sync.never")}</dd>
          <dt>{t("settings.library")}</dt><dd><a href="/library/" target="_blank" rel="noreferrer">{t("settings.openLibrary")}</a></dd>
        </dl>
        <Button variant="ghost" onClick={onLogout} style={{ marginTop: 8 }}><IconLogout size={18} /> {t("common.signOut")}</Button>
      </Card>

      {notice ? (
        <Sheet title={t("privacy.title")} onClose={() => setNotice(false)} wide footer={needsAck ? <Button variant="primary" disabled={!online} onClick={async () => { try { await ackPrivacy(me!.privacyNoticeVersion); setNotice(false); } catch (e) { toast.error(errorKey(e).message); } }}>{t("privacy.ack")}</Button> : <Button onClick={() => setNotice(false)}>{t("common.close")}</Button>}>
          {ref.privacyNotice ? <p className="small muted">{t("settings.noticeVersion", { version: ref.privacyNotice.version, date: fmtDate(ref.privacyNotice.effectiveFrom, lang) })}</p> : null}
          <div style={{ whiteSpace: "pre-wrap" }}>{noticeBody || t("settings.noticeMissing")}</div>
        </Sheet>
      ) : null}
      {problem ? <ProblemSheet onClose={() => setProblem(false)} /> : null}
    </div>
  );
}

function ProblemSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { me } = useSession();
  const sync = useSync();
  const [text, setText] = useState("");
  const [diag, setDiag] = useState("");
  useEffect(() => {
    (async () => {
      const est = await storageEstimate();
      setDiag([
        `SafeWorks field ${APP_VERSION}`, `user: ${me?.employeeCode ?? ""} (${me?.id ?? ""})`, `device: ${deviceId()}`, ...Object.entries(deviceInfo()).map(([k, v]) => `${k}: ${v}`),
        `storage: ${est.usageMB ?? "?"} / ${est.quotaMB ?? "?"} MB`, `sync: online=${sync.online} pending=${sync.pending} failed=${sync.failed} last=${sync.lastSyncedAt ?? "never"} err=${sync.lastError ?? ""}`,
        "--- sync log ---", ...syncLog().slice(-40).map((l) => `${l.at} ${l.level} ${l.msg}`),
      ].join("\n"));
    })();
  }, [me, sync]);
  const body = `${text}\n\n--- diagnostics ---\n${diag}`;
  return (
    <Sheet title={t("settings.reportProblem")} onClose={onClose} footer={
      <>
        <Button onClick={async () => { if (await copyText(body)) toast.success(t("common.copied")); }}><IconCopy size={16} /> {t("common.copy")}</Button>
        <Button variant="primary" onClick={() => { location.href = `mailto:?subject=${encodeURIComponent(`SafeWorks problem report (${me?.employeeCode ?? ""})`)}&body=${encodeURIComponent(body.slice(0, 6000))}`; }}><IconSend size={16} /> {t("settings.sendEmail")}</Button>
      </>
    }>
      <Field label={t("settings.whatHappened")} required>
        <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
      <details><summary className="small muted">{t("settings.diagIncluded")}</summary><pre className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{diag}</pre></details>
    </Sheet>
  );
}
