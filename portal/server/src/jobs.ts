import nodemailer from "nodemailer";
import { config } from "./config.js";
import { pool, q } from "./db.js";
import { emailTo, notify } from "./notify.js";
import { mergeSettings } from "./settings.js";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let warned = false;

async function sendEmails(): Promise<void> {
  if (!config.smtpUrl) {
    if (!warned) {
      console.warn("[mail] SMTP_URL not set: emails stay queued in email_outbox and are not sent.");
      warned = true;
    }
    return;
  }
  transporter ||= nodemailer.createTransport(config.smtpUrl);
  const batch = await q<any>(
    `select id, to_addr, subject, body, attempts from email_outbox
      where sent_at is null and next_try_at <= now() and attempts < 8 order by id limit 50`,
  );
  for (const m of batch) {
    try {
      await transporter.sendMail({ from: config.mailFrom, to: m.to_addr, subject: m.subject, text: m.body });
      await q(`update email_outbox set sent_at = now(), attempts = attempts + 1 where id = $1`, [m.id]);
    } catch (e: any) {
      const wait = Math.min(2 ** m.attempts * 60, 6 * 3600);
      await q(`update email_outbox set attempts = attempts + 1, last_error = $2, next_try_at = now() + make_interval(secs => $3) where id = $1`, [m.id, String(e?.message ?? e).slice(0, 500), wait]);
    }
  }
}

/** Mark a reminder key once; returns true only the first time. */
async function once(client: any, key: string): Promise<boolean> {
  const r = await client.query(`insert into job_marks (key) values ($1) on conflict do nothing returning key`, [key]);
  return r.rowCount === 1;
}

async function reminders(): Promise<void> {
  const client = await pool.connect();
  try {
    // Only one server instance runs reminders at a time.
    const lock = await client.query(`select pg_try_advisory_lock(424242) as ok`);
    if (!lock.rows[0].ok) return;
    try {
      const orgs = await q<any>(`select id, settings from organisations`, [], client);
      for (const org of orgs) {
        const s = mergeSettings(org.settings);
        // Due soon → action owner
        const dueSoon = await q<any>(
          `select o.id, o.code, o.owner_id, o.due_at, s.name as site_name from observations o join sites s on s.id = o.site_id
            where o.org_id = $1 and o.status in ('open','in_progress') and o.owner_id is not null
              and o.due_at > now() and o.due_at <= now() + make_interval(hours => $2)`,
          [org.id, s.dueReminderHours],
          client,
        );
        for (const o of dueSoon) {
          if (await once(client, `due:${o.id}:${new Date(o.due_at).toISOString()}`)) {
            await notify(client, [o.owner_id], { kind: "due_soon", observationId: o.id, title: `${o.code} is due ${new Date(o.due_at).toLocaleString("en-IN", { timeZone: config.timezone })}`, body: o.site_name });
          }
        }
        // Overdue → owner + site safety officers (once per day)
        const overdue = await q<any>(
          `select o.id, o.code, o.owner_id, o.site_id, o.due_at, s.name as site_name, s.site_head_email,
                  floor(extract(epoch from (now() - o.due_at)) / 86400)::int as days
             from observations o join sites s on s.id = o.site_id
            where o.org_id = $1 and o.status in ('open','in_progress') and o.due_at < now()`,
          [org.id],
          client,
        );
        const today = new Date().toISOString().slice(0, 10);
        for (const o of overdue) {
          if (await once(client, `overdue:${o.id}:${today}`)) {
            const sos = await q<any>(`select user_id from memberships where site_id = $1 and role = 'safety_officer'`, [o.site_id], client);
            await notify(client, [o.owner_id, ...sos.map((x: any) => x.user_id)], {
              kind: "overdue", observationId: o.id, title: `${o.code} is overdue (${Math.max(o.days, 0)} day${o.days === 1 ? "" : "s"})`, body: o.site_name,
            });
          }
          if (o.days >= s.escalation.siteHeadDays && o.site_head_email && (await once(client, `esc1:${o.id}`))) {
            await emailTo(client, o.site_head_email, `${o.code} overdue by ${o.days} days`, `Observation ${o.code} at ${o.site_name} is overdue by ${o.days} days.\n\nOpen: ${config.publicUrl}/o/${o.id}`);
          }
          if (o.days >= s.escalation.adminDays && (await once(client, `esc2:${o.id}`))) {
            const admins = await q<any>(`select user_id from memberships where org_id = $1 and site_id is null and role = 'org_admin'`, [org.id], client);
            await notify(client, admins.map((a: any) => a.user_id), {
              kind: "escalation", observationId: o.id, title: `Escalation: ${o.code} overdue by ${o.days} days`, body: o.site_name,
            });
          }
        }
      }
      await q(`delete from job_marks where at < now() - interval '120 days'`, [], client);
      await q(`delete from sessions where expires_at < now() - interval '30 days'`, [], client);
    } finally {
      await client.query(`select pg_advisory_unlock(424242)`);
    }
  } finally {
    client.release();
  }
}

export function startJobs(): () => void {
  const t1 = setInterval(() => sendEmails().catch((e) => console.error("[mail]", e.message)), 30_000);
  const t2 = setInterval(() => reminders().catch((e) => console.error("[jobs]", e.message)), 5 * 60_000);
  setTimeout(() => reminders().catch((e) => console.error("[jobs]", e.message)), 15_000);
  return () => {
    clearInterval(t1);
    clearInterval(t2);
  };
}

export { reminders as runReminders, sendEmails };
