/* Scan an area or asset QR: BarcodeDetector + camera when the browser has it, else type the token or tag number.
   QR payloads are the server URLs (…/q/<token> or …/scan/<token>). An asset token opens the asset's checklist
   (or quick report); an area token opens the quick report pre-filled. Resolution tries the local reference data
   first so it works offline, then GET /public/qr/{token}. */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { QrInfo } from "../../shared/types";
import { useI18n } from "../../shared/i18n";
import { Button, Card, ErrorCard, Field, Form, Input, Pill, Skeleton } from "../../shared/ui";
import { IconQr, IconCamera, IconClipboard, IconPlus, IconAlert } from "../../shared/icons";
import { errorKey } from "../../shared/api";
import { api } from "../api";
import { useRefData } from "../offline/store";
import { SubHead } from "../components/common";
import { StartSheet } from "./Inspections";
import { fmtDate } from "../../shared/format";

type Detector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: new (opts?: { formats: string[] }) => Detector } }

export function tokenFromPayload(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/\/(?:q|scan)\/([A-Za-z0-9_-]{4,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{4,}$/.test(s)) return s;
  return null;
}

export default function Scan() {
  const { token } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const [manual, setManual] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const supported = typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!supported || token || !active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(v);
            const hit = codes.map((c) => tokenFromPayload(c.rawValue)).find(Boolean);
            if (hit) { stopped = true; nav(`/scan/${hit}`); return; }
          } catch { /* frame not ready */ }
          raf = window.setTimeout(tick, 250) as unknown as number;
        };
        void tick();
      } catch { setCamErr(t("scan.cameraDenied")); }
    })();
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [supported, token, active, nav, t]);

  if (token) return <Resolve token={token} />;
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <SubHead title={t("nav.scan")} />
      {supported ? (
        active ? (
          <div className="scanner"><video ref={videoRef} muted playsInline /><div className="frame" aria-hidden /></div>
        ) : <Button variant="primary" block size="lg" onClick={() => setActive(true)}><IconCamera size={20} /> {t("scan.openCamera")}</Button>
      ) : <div className="hint-box"><IconQr size={14} /> {t("scan.noDetector")}</div>}
      {camErr ? <div className="banner failed" style={{ marginTop: 10 }}><IconAlert size={16} /><span>{camErr}</span></div> : null}
      <Card style={{ marginTop: 14 }}>
        <Form onSubmit={() => { const tk = tokenFromPayload(manual); if (!tk) { setErr(t("scan.invalid")); return; } nav(`/scan/${tk}`); }}>
          <Field label={t("scan.manual")} hint={t("scan.manualHint")} error={err}>
            <Input value={manual} onChange={(e) => { setManual(e.target.value); setErr(null); }} placeholder="TN1-GATE-01 / https://…/q/abc123" autoCapitalize="none" />
          </Field>
          <Button type="submit" variant="primary" block>{t("scan.resolve")}</Button>
        </Form>
      </Card>
    </div>
  );
}

function Resolve({ token }: { token: string }) {
  const { t, pick } = useI18n();
  const nav = useNavigate();
  const ref = useRefData();
  const [info, setInfo] = useState<QrInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(false);
  const [n, setN] = useState(0);
  // offline first: an asset whose qrToken or tag number matches
  const localAsset = ref.assets.find((a) => a.qrToken === token || a.tagNo.toLowerCase() === token.toLowerCase()) ?? null;
  useEffect(() => {
    if (localAsset) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.get<QrInfo>(`/public/qr/${encodeURIComponent(token)}`).then((i) => { if (!cancelled) { setInfo(i); setError(null); } }, (e) => { if (!cancelled) setError(e); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, localAsset, n]);

  const asset = localAsset ?? (info?.asset ? ref.assets.find((a) => a.id === info.asset!.id) ?? null : null);
  const siteId = asset?.siteId ?? info?.site.id ?? null;
  const areaId = asset?.areaId ?? info?.area?.id ?? null;
  const site = ref.sites.find((s) => s.id === siteId);
  const area = ref.areas.find((a) => a.id === areaId);

  if (loading) return <div className="page"><SubHead title={t("nav.scan")} /><Skeleton lines={5} /></div>;
  if (!asset && !info) return <div className="page"><SubHead title={t("nav.scan")} /><ErrorCard error={error instanceof Error ? new Error(`${t("scan.notFound")} — ${errorKey(error).message}`) : new Error(t("scan.notFound"))} onRetry={() => setN((x) => x + 1)} /></div>;

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <SubHead title={asset ? asset.tagNo : area ? pick(area.name) : pick(info?.site.name)} kicker={site ? `${site.code} · ${pick(site.name)}` : pick(info?.site.name)} />
      {asset ? (
        <Card>
          <div className="row between">
            <div><h2 style={{ fontSize: 20, margin: 0 }}>{asset.tagNo}</h2><div className="small muted">{t(`assetClass.${asset.assetClass}`)} · {asset.makeModel}{asset.swlKg ? ` · SWL ${asset.swlKg} kg` : ""}</div></div>
            <Pill tone={asset.status === "in_service" ? "green" : "red"} dot>{t(`asset.status.${asset.status}`)}</Pill>
          </div>
          {asset.status === "do_not_use" ? <div className="banner critical" style={{ marginTop: 10 }}><IconAlert size={18} /><span>{t("scan.doNotUse")}{asset.statusReason ? ` — ${asset.statusReason}` : ""}</span></div> : null}
          {asset.nextExamDue ? <p className="small" style={{ marginTop: 8 }}>{t("scan.nextExam", { date: fmtDate(asset.nextExamDue) })}{new Date(asset.nextExamDue).getTime() < Date.now() ? <b style={{ color: "var(--red)" }}> · {t("scan.examOverdue")}</b> : null}</p> : null}
          <div className="btn-group" style={{ marginTop: 12 }}>
            <Button variant="primary" onClick={() => setStart(true)}><IconClipboard size={18} /> {t("scan.startChecklist")}</Button>
            <Button onClick={() => nav(`/report?site=${asset.siteId}&area=${asset.areaId ?? ""}&asset=${asset.id}`)}><IconPlus size={18} /> {t("nav.report")}</Button>
          </div>
        </Card>
      ) : (
        <Card>
          <p>{t("scan.areaFound", { area: area ? pick(area.name) : pick(info?.area?.name) || pick(info?.site.name) })}</p>
          <div className="btn-group">
            <Button variant="primary" onClick={() => nav(`/report?site=${siteId}&area=${areaId ?? ""}`)}><IconPlus size={18} /> {t("nav.report")}</Button>
            <Button onClick={() => setStart(true)}><IconClipboard size={18} /> {t("insp.start")}</Button>
          </div>
        </Card>
      )}
      {start ? <StartSheet assetId={asset?.id ?? null} areaId={areaId} onClose={() => setStart(false)} /> : null}
    </div>
  );
}
