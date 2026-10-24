import { FormEvent, useState } from "react";
import { Field, Select } from "../../shared/forms";
import { daysAgo, todayLocal } from "../../shared/format";
import { IconDownload } from "../../shared/icons";
import { useToast } from "../../shared/ui";
import { api, errMsg, saveBlob } from "../ctx";
import { PageHead, useAdminSites } from "./common";

export default function Reports() {
  const toast = useToast();
  const sites = useAdminSites();
  const [siteId, setSiteId] = useState("");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayLocal());
  const [busy, setBusy] = useState(false);

  async function download(e: FormEvent) {
    e.preventDefault();
    if (from > to) return toast("The start date is after the end date.", true);
    setBusy(true);
    try {
      const blob = await api.download("/api/admin/export/observations.csv", { siteId: siteId || undefined, from, to });
      const code = sites.data?.sites.find((s) => s.id === siteId)?.code ?? "all-sites";
      saveBlob(blob, `safeworks-observations-${code}-${from}-to-${to}.csv`);
      toast("Register downloaded");
    } catch (err) {
      toast(errMsg(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <PageHead title="Reports & export" sub="Download the observation register for Excel, the safety committee or BRSR leading indicators." />
      <form className="section stack" onSubmit={download}>
        <h3>Observation register (CSV)</h3>
        <p className="small muted">
          One row per observation raised in the period, with every field, the action owner, due and closure dates, days to close and links to the photos. Photo links stay valid
          for 7 days. Opens in Excel. Each download is recorded in the audit log.
        </p>
        <div className="grid-2">
          <Field label="Site" htmlFor="r-site">
            <Select id="r-site" value={siteId} onChange={setSiteId} placeholder="All sites" options={(sites.data?.sites ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
          </Field>
          <div />
          <Field label="Raised from" htmlFor="r-from">
            <input id="r-from" className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field label="Raised to" htmlFor="r-to">
            <input id="r-to" className="input" type="date" value={to} min={from} max={todayLocal()} onChange={(e) => setTo(e.target.value)} required />
          </Field>
        </div>
        <div className="row-wrap">
          {[
            { label: "Last 30 days", d: 30 },
            { label: "Last 90 days", d: 90 },
            { label: "Last 12 months", d: 365 },
          ].map((p) => (
            <button
              type="button"
              key={p.d}
              className="chip"
              onClick={() => {
                setFrom(daysAgo(p.d - 1));
                setTo(todayLocal());
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div>
          <button className="btn btn-primary" disabled={busy}>
            <IconDownload size={18} /> {busy ? "Preparing…" : "Download register"}
          </button>
        </div>
      </form>
    </div>
  );
}
