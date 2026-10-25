/* Sign-in: language first (four scripts), then employee code or email + password, the enrolment-code path for
   first-time workers, the TOTP step (with enrolment when the account has no authenticator yet) and the
   must-change-password step. */
import { useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Button, Field, Form, Input, Card, useToast } from "../../shared/ui";
import { errorKey, isNative, serverBase } from "../../shared/api";
import { copyText } from "../../shared/storage";
import { useSession } from "../session";
import { LangGrid } from "../components/common";
import { APP_VERSION } from "../api";
import type { MfaEnrolResponse } from "../../shared/types";
import { useOutbox } from "../offline/store";

export default function Login() {
  const { t, lang, setLang } = useI18n();
  const { status, me } = useSession();
  const [mode, setMode] = useState<"password" | "enrol">("password");
  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div className="login-brand">
          <span className="mark">SW</span>
          <div><h1 style={{ fontSize: 24, margin: 0 }}>{t("app.name")}</h1><div className="small muted">{t("login.tagline")}</div></div>
        </div>
        {status === "mfa" ? <MfaStep /> : status === "must_change" ? <MustChange name={me?.name} /> : (
          <>
            <Field label={t("common.language")}><LangGrid value={lang} onChange={setLang} /></Field>
            {mode === "password" ? <PasswordStep onEnrol={() => setMode("enrol")} /> : <EnrolStep onBack={() => setMode("password")} />}
          </>
        )}
        <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>
          v{APP_VERSION}{isNative ? ` · ${serverBase()}` : ""} · <a href="/library/" target="_blank" rel="noreferrer">{t("login.library")}</a>
        </p>
      </Card>
    </div>
  );
}

function useErr() {
  const { t } = useI18n();
  const [err, setErr] = useState<string | null>(null);
  return { err, setErr, fromError: (e: unknown) => { const { key, message } = errorKey(e); setErr(key === "error.generic" && message ? message : t(key)); } };
}

function PasswordStep({ onEnrol }: { onEnrol: () => void }) {
  const { t } = useI18n();
  const { login } = useSession();
  const { data: outbox } = useOutbox();
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const { err, setErr, fromError } = useErr();
  const pending = outbox.filter((x) => x.status !== "synced").length;
  const submit = async () => {
    if (!user.trim() || !pw) { setErr(t("login.fillBoth")); return; }
    setBusy(true); setErr(null);
    try { await login(user, pw); } catch (e) { fromError(e); } finally { setBusy(false); }
  };
  return (
    <Form onSubmit={submit}>
      {pending > 0 ? <div className="hint-box" style={{ marginBottom: 12 }}>{t("login.pendingKept", { count: pending })}</div> : null}
      <Field label={t("login.user")} required>
        <Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" inputMode="email" autoCapitalize="none" autoFocus placeholder={t("login.userHint")} />
      </Field>
      <Field label={t("login.password")} required error={err}>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
      </Field>
      <Button type="submit" variant="primary" block size="lg" loading={busy}>{t("login.signIn")}</Button>
      <div className="row between" style={{ marginTop: 12 }}>
        <Button variant="ghost" size="sm" onClick={onEnrol}>{t("login.haveCode")}</Button>
        <span className="small muted">{t("login.forgot")}</span>
      </div>
    </Form>
  );
}

function EnrolStep({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { enrol } = useSession();
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const { err, setErr, fromError } = useErr();
  const submit = async () => {
    if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) { setErr(t("login.pwRule")); return; }
    if (pw !== pw2) { setErr(t("login.pwMismatch")); return; }
    setBusy(true); setErr(null);
    try { await enrol(code, pw); } catch (e) { fromError(e); } finally { setBusy(false); }
  };
  return (
    <Form onSubmit={submit}>
      <p className="small muted">{t("login.enrolHint")}</p>
      <Field label={t("login.enrolCode")} required>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoFocus inputMode="text" />
      </Field>
      <Field label={t("login.newPassword")} required hint={t("login.pwRule")}>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label={t("login.repeatPassword")} required error={err}>
        <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      </Field>
      <Button type="submit" variant="primary" block size="lg" loading={busy}>{t("login.enrolSubmit")}</Button>
      <Button variant="ghost" size="sm" onClick={onBack} style={{ marginTop: 10 }}>{t("common.back")}</Button>
    </Form>
  );
}

function MfaStep() {
  const { t } = useI18n();
  const toast = useToast();
  const { mfa, mfaEnrolled, mfaEnrolStart, mfaConfirm, forceSignOutKeepData } = useSession();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrol, setEnrol] = useState<MfaEnrolResponse | null>(null);
  const [enrolErr, setEnrolErr] = useState<unknown>(null);
  const { err, setErr, fromError } = useErr();
  useEffect(() => {
    if (mfaEnrolled) return;
    mfaEnrolStart().then(setEnrol, setEnrolErr);
  }, [mfaEnrolled, mfaEnrolStart]);
  const submit = async () => {
    if (!/^\d{6}$/.test(code.trim())) { setErr(t("login.mfaFormat")); return; }
    setBusy(true); setErr(null);
    try { if (mfaEnrolled) await mfa(code); else await mfaConfirm(code); } catch (e) { fromError(e); } finally { setBusy(false); }
  };
  return (
    <Form onSubmit={submit}>
      <h2 style={{ fontSize: 20 }}>{mfaEnrolled ? t("login.mfaTitle") : t("login.mfaEnrolTitle")}</h2>
      {!mfaEnrolled ? (
        enrol ? (
          <div className="stack" style={{ marginBottom: 12 }}>
            <p className="small">{t("login.mfaEnrolHint")}</p>
            <div className="row">
              <code className="mono" style={{ wordBreak: "break-all", flex: 1 }}>{enrol.secret}</code>
              <Button size="sm" onClick={async () => { if (await copyText(enrol.secret)) toast.success(t("common.copied")); }}>{t("common.copy")}</Button>
            </div>
            <a href={enrol.otpauthUrl} className="small">{t("login.mfaOpenApp")}</a>
          </div>
        ) : enrolErr ? <p className="small" style={{ color: "var(--red)" }}>{errorKey(enrolErr).message}</p> : <p className="small muted">{t("common.loading")}</p>
      ) : <p className="small muted">{t("login.mfaHint")}</p>}
      <Field label={t("login.mfaCode")} required error={err}>
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} />
      </Field>
      <Button type="submit" variant="primary" block size="lg" loading={busy}>{t("login.verify")}</Button>
      <Button variant="ghost" size="sm" onClick={forceSignOutKeepData} style={{ marginTop: 10 }}>{t("common.back")}</Button>
    </Form>
  );
}

function MustChange({ name }: { name?: string }) {
  const { t } = useI18n();
  const { changePassword, forceSignOutKeepData } = useSession();
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const { err, setErr, fromError } = useErr();
  const submit = async () => {
    if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) { setErr(t("login.pwRule")); return; }
    if (pw !== pw2) { setErr(t("login.pwMismatch")); return; }
    setBusy(true); setErr(null);
    try { await changePassword(cur, pw); } catch (e) { fromError(e); } finally { setBusy(false); }
  };
  return (
    <Form onSubmit={submit}>
      <h2 style={{ fontSize: 20 }}>{t("login.mustChangeTitle")}</h2>
      <p className="small muted">{name ? t("login.mustChangeHintNamed", { name }) : t("login.mustChangeHint")}</p>
      <Field label={t("login.currentPassword")} required><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" autoFocus /></Field>
      <Field label={t("login.newPassword")} required hint={t("login.pwRule")}><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
      <Field label={t("login.repeatPassword")} required error={err}><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
      <Button type="submit" variant="primary" block size="lg" loading={busy}>{t("login.changeAndContinue")}</Button>
      <Button variant="ghost" size="sm" onClick={forceSignOutKeepData} style={{ marginTop: 10 }}>{t("common.signOut")}</Button>
    </Form>
  );
}
