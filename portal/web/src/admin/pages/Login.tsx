/* Sign-in for the console: employee code or email + password → TOTP (with first-time enrolment) → must-change-password. */
import { useEffect, useMemo, useState } from "react";
import { useI18n, LANGS, LANG_NAMES } from "../../shared/i18n";
import type { Lang } from "../../shared/types";
import { Button, Field, Form, Input, Select, useToast } from "../../shared/ui";
import { IconKey, IconLock, IconShield } from "../../shared/icons";
import { useAuth } from "../auth";
import { errMessage, errCode } from "../api";
import { encodeQr, qrPath } from "../qr";
import { Copyable } from "../components";

export default function Login() {
  const { t, lang, setLang } = useI18n();
  const { stage, login, submitMfa, startEnrol, confirmEnrol, enrol, changePassword, logout, pendingLogin } = useAuth();
  const toast = useToast();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");

  useEffect(() => { setErr(""); setCode(""); }, [stage]);
  useEffect(() => { if (stage === "enrol" && !enrol) startEnrol().catch((e) => setErr(errMessage(e))); }, [stage, enrol, startEnrol]);

  const qr = useMemo(() => {
    if (!enrol?.otpauthUrl) return null;
    try { const m = encodeQr(enrol.otpauthUrl, "M"); return { size: m.size, d: qrPath(m) }; } catch { return null; }
  }, [enrol]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr("");
    try { await fn(); } catch (e) {
      const c = errCode(e);
      setErr(c === "rate_limited" ? t("login.locked") : errMessage(e));
    } finally { setBusy(false); }
  };

  const pwProblem = next && (next.length < 12 || !/[a-zA-Z]/.test(next) || !/\d/.test(next)) ? t("login.passwordRule", { min: 12 }) : next && again && next !== again ? t("login.passwordMismatch") : "";

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand"><span className="mark">SW</span><div><h1>{t("app.console")}</h1><div className="small muted">{t("login.tagline")}</div></div></div>

        {stage === "login" || stage === "booting" ? (
          <Form onSubmit={() => run(() => login(id.trim(), pw))}>
            <Field label={t("login.id")} required hint={t("login.idHint")}>
              <Input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoFocus inputMode="email" />
            </Field>
            <Field label={t("login.password")} required error={err}>
              <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            </Field>
            <Button type="submit" variant="primary" block loading={busy || stage === "booting"} disabled={!id.trim() || !pw}>{t("login.signIn")}</Button>
            <Field label={t("common.language")}>
              <Select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}</Select>
            </Field>
            <p className="small muted" style={{ margin: 0 }}>{t("login.staffOnly")}</p>
          </Form>
        ) : null}

        {stage === "mfa" ? (
          <Form onSubmit={() => run(() => submitMfa(code.replace(/\s/g, "")))}>
            <div className="row" style={{ marginBottom: 10 }}><IconShield /><strong>{t("login.mfaTitle")}</strong></div>
            <p className="small muted">{t("login.mfaBody", { user: pendingLogin })}</p>
            <Field label={t("login.code")} required error={err}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" pattern="[0-9 ]*" autoComplete="one-time-code" autoFocus maxLength={7} style={{ fontSize: 22, letterSpacing: ".3em", textAlign: "center" }} />
            </Field>
            <Button type="submit" variant="primary" block loading={busy} disabled={code.replace(/\s/g, "").length !== 6}>{t("login.verify")}</Button>
            <Button variant="ghost" block onClick={() => void logout()} style={{ marginTop: 8 }}>{t("login.backToSignIn")}</Button>
          </Form>
        ) : null}

        {stage === "enrol" ? (
          <Form onSubmit={() => run(() => confirmEnrol(code.replace(/\s/g, "")))}>
            <div className="row" style={{ marginBottom: 10 }}><IconShield /><strong>{t("login.enrolTitle")}</strong></div>
            <p className="small">{t("login.enrolBody")}</p>
            {enrol ? (
              <div className="stack" style={{ gap: 10, marginBottom: 12 }}>
                {qr ? (
                  <div className="qr-box">
                    <svg viewBox={`-3 -3 ${qr.size + 6} ${qr.size + 6}`} role="img" aria-label={t("login.enrolQr")} shapeRendering="crispEdges">
                      <rect x={-3} y={-3} width={qr.size + 6} height={qr.size + 6} fill="#fff" />
                      <path d={qr.d} fill="#0f1c2b" />
                    </svg>
                  </div>
                ) : null}
                <div className="small muted">{t("login.enrolManual")}</div>
                <Copyable value={enrol.secret} />
              </div>
            ) : <p className="small muted">{t("common.loading")}</p>}
            <Field label={t("login.codeFromApp")} required error={err}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} style={{ fontSize: 22, letterSpacing: ".3em", textAlign: "center" }} />
            </Field>
            <Button type="submit" variant="primary" block loading={busy} disabled={!enrol || code.replace(/\s/g, "").length !== 6}>{t("login.enrolConfirm")}</Button>
            <Button variant="ghost" block onClick={() => void logout()} style={{ marginTop: 8 }}>{t("login.backToSignIn")}</Button>
          </Form>
        ) : null}

        {stage === "changePassword" ? (
          <Form onSubmit={() => run(async () => { if (pwProblem) throw new Error(pwProblem); await changePassword(cur, next); toast.success(t("login.passwordChanged")); })}>
            <div className="row" style={{ marginBottom: 10 }}><IconKey /><strong>{t("login.mustChangeTitle")}</strong></div>
            <p className="small">{t("login.mustChangeBody")}</p>
            <Field label={t("login.currentPassword")} required><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" autoFocus /></Field>
            <Field label={t("login.newPassword")} required hint={t("login.passwordRule", { min: 12 })} error={pwProblem || err}><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
            <Field label={t("login.repeatPassword")} required><Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></Field>
            <Button type="submit" variant="primary" block loading={busy} disabled={!cur || !next || !again || !!pwProblem}><IconLock size={16} />{t("login.setPassword")}</Button>
            <Button variant="ghost" block onClick={() => void logout()} style={{ marginTop: 8 }}>{t("common.signOut")}</Button>
          </Form>
        ) : null}
      </div>
    </div>
  );
}
