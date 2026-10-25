/* First run of the Android app: where is the SafeWorks server? Checked with GET /health before it is saved. */
import { useState } from "react";
import { useI18n } from "../../shared/i18n";
import { Button, Card, Field, Form, Input } from "../../shared/ui";
import { serverBase, setServerBase, API_PREFIX } from "../../shared/api";
import { useSession } from "../session";
import { LangGrid } from "../components/common";

export default function ServerAddress({ embedded, onSaved }: { embedded?: boolean; onSaved?: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { serverConfigured } = useSession();
  const [url, setUrl] = useState(serverBase() || "https://");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const check = async () => {
    const clean = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s/]+/.test(clean)) { setErr(t("server.invalid")); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${clean}${API_PREFIX}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const body = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
      if (!res.ok || !body?.ok) { setErr(t("server.notSafeworks")); return; }
      setServerBase(clean);
      setOk(t("server.connected", { version: body.version ?? "" }));
      if (onSaved) onSaved(); else serverConfigured();
    } catch {
      setErr(t("server.unreachable"));
    } finally { setBusy(false); }
  };
  const body = (
    <Form onSubmit={check}>
      {!embedded ? <Field label={t("common.language")}><LangGrid value={lang} onChange={setLang} /></Field> : null}
      <Field label={t("server.address")} hint={t("server.hint")} error={err} required>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoFocus placeholder="https://safeworks.example.in" />
      </Field>
      {ok ? <p className="small" style={{ color: "var(--green)" }}>{ok}</p> : null}
      <Button type="submit" variant="primary" block size="lg" loading={busy}>{t("server.connect")}</Button>
    </Form>
  );
  if (embedded) return body;
  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div className="login-brand"><span className="mark">SW</span><div><h1 style={{ fontSize: 24, margin: 0 }}>{t("app.name")}</h1><div className="small muted">{t("server.title")}</div></div></div>
        {body}
      </Card>
    </div>
  );
}
