# SafeWorks Portal — production hosting plan (3 November 2026)

**Recommendation: AWS Lightsail, Mumbai, Linux 2 GB plan (US$12/month + GST) for production. Keep Render as the test server.**
Nothing in the code changes: `portal/deploy/install.sh` already installs the whole stack (Docker, PostgreSQL, HTTPS, daily backups) on any Ubuntu server.

Prices and policies below were checked on 3 Nov 2026 from the providers' pages; confirm them again on the day you sign up.

---

## 1. The clock

| Date | What happens |
|---|---|
| **24 Nov 2026** | Render's free database expires (date shown on the `safeworks-db` page in Render). The test server stops working. |
| ~8 Dec 2026 | End of Render's 14-day grace period. If the database isn't upgraded to a paid plan, Render deletes it and its data. |

The Render database holds **test data only** (demo company, demo users), so losing it costs nothing real. The deadline matters because the pilot needs somewhere to run, not because data is at risk.

---

## 2. Options compared

| | **Lightsail Mumbai 2 GB** (recommended) | Oracle Always Free, Mumbai | Render paid (Singapore) | Render free (now) |
|---|---|---|---|---|
| Monthly cost | US$12 + 18% GST ≈ **₹1,250**; snapshots ≈ US$1–2 more | ₹0 | web Starter ≈ US$7 + database from ≈ US$6, plus disk | ₹0 |
| Machine | 2 vCPU, 2 GB RAM, 60 GB SSD, 1.5 TB transfer/month (Mumbai gets half the usual allowance; still ~1,000× what the pilot needs) | Arm, up to 4 cores / 24 GB (some blogs report a cut to 2 / 12 GB from June 2026; not confirmed by Oracle) | 0.5 CPU / 512 MB | 0.1 CPU / 512 MB, sleeps after 15 min |
| Data in India | Yes | Yes | No (Singapore) | No |
| Backups | Our daily `pg_dump` + Lightsail automatic daily snapshots (whole disk, off the machine) | Our daily `pg_dump` only, same disk | Render's paid backups | None |
| Risks | Sign-up needs a card that works online (AWS India bills in rupees) | Sign-up already failed 3 times. **Idle reclaim:** Oracle can take back a free VM whose CPU stays under ~20% for 7 days. A quiet pilot server looks exactly like that. Arm capacity in Mumbai is often "out of capacity". | Data outside India; small machine | Expires; sleeps; test only |
| Fits production? | **Yes** | Only after upgrading to Pay-As-You-Go (stops idle reclaim, still free within limits). That needs the same card check that failed. | Possible, but not in India | No |

**Why Lightsail wins:** it's in India, the price is fixed and small, it has off-machine snapshots built in, and it doesn't depend on a sign-up that has already failed three times. Oracle stays a free option for a second test server if its sign-up ever works.

**Data residency:** the DPDP Act 2023 allows personal data to go abroad unless the government restricts a country, and the DPDP Rules 2025 phase in over 18 months *(verify with the legal reviewer)*. Hosting in Mumbai avoids the question entirely, which fits the decision already recorded in `DECISIONS.md` #7.

---

## 3. How the two servers fit together

| | Render (test) | Lightsail (production) |
|---|---|---|
| Purpose | Try new versions, demos, training | Real sites, real workers |
| Data | Demo company, re-seeded on start | Real company, never demo data |
| Updates | Automatic after CI passes on `main` | By hand, after a version has run on Render: `git pull && sudo bash portal/deploy/install.sh` |
| Address | `safeworks-portal.onrender.com` | Your domain (see 4.1) |

That gives a safe order for every release: CI green → Render updates itself → you click through it → then update production.

---

## 4. Step by step

### 4.1 Decide before anything else (owner)

1. **The production address.** It's printed inside every QR poster (`https://<address>/q/<token>`) and typed into every phone's app. Changing it later means reprinting all posters and re-entering it on every phone, so fix it **before** printing posters.
   - Own domain, e.g. `safety.yourcompany.in` (a sub-domain of the company's domain costs nothing; a new `.in` domain is about ₹800–1,200/year). **Recommended.**
   - Free: `<ip-with-dashes>.sslip.io`. Works, but it's tied to the server's IP address and looks odd on a poster.
2. **Whose AWS account.** A company account is better than a personal one: billing, invoices with GST, and access survive staff changes.
3. **Who keeps the off-site backup copy** (step 4.4.3).

### 4.2 Create the server (about 20 minutes, in the AWS console)

1. Sign up at aws.amazon.com (India accounts are billed in rupees with GST). Turn on MFA for the root login straight away, then use a separate IAM user for daily work.
2. Lightsail → **Create instance** → Region **Mumbai (ap-south-1)** → Linux/Unix → **OS only: Ubuntu 24.04 LTS** → plan **US$12 (2 GB RAM, 2 vCPU, 60 GB SSD)** → name `safeworks-prod`.
3. **Networking → Create static IP** and attach it to the instance. Free while attached. Without it the IP changes when the server restarts, and the address breaks.
4. **Networking → IPv4 firewall**: keep SSH (22); add **HTTPS (443)** and **HTTP (80)**. Port 80 is needed only for the certificate and redirects to HTTPS. Restrict SSH to your own IP if your connection has a fixed one.
5. If you use your own domain: add a DNS **A record** for it that points at the static IP. Wait until `nslookup <domain>` shows the IP.

### 4.3 Install SafeWorks (about 15 minutes, in the SSH window)

Open **Connect using SSH** in Lightsail, then:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/Julyraj/safeworks-india.git
cd safeworks-india
sudo bash portal/deploy/install.sh --domain safety.yourcompany.in --company "Your Company Name"
```

- **No `--demo`.** Production starts empty, with just the `ADMIN01` login.
- Leave out `--domain` to use the free `sslip.io` address.
- The first build takes 5–10 minutes. At the end the script prints the address and the `ADMIN01` password, and saves them in `/root/safeworks-login.txt`. Move the password into a password manager, then delete that file.
- Check: open `https://<address>/api/v1/health`, then `/admin/`, sign in as `ADMIN01` and enrol MFA.

### 4.4 Protect it (about 15 minutes)

1. **Lightsail automatic snapshots**: Instance → Snapshots → turn on automatic daily snapshots (keeps 7). This is the copy that survives a broken disk. It costs about US$0.05 per GB-month of used space.
2. **The script's daily backup** already runs at 03:00 IST into `/var/backups/safeworks` (database + photos, 7 days kept).
3. **Off-site copy, monthly**: copy the newest `db-*.dump` and `photos-*.tar.gz` to company storage (Lightsail → download, or `scp`). Snapshots live in the same AWS account, so this copy protects against losing the account itself.
4. **Restore drill, once, before the pilot**: create a temporary instance from last night's snapshot, open it, check the data, then delete it. Untested backups don't count as backups.
5. Ubuntu security updates install themselves (`unattended-upgrades` is on by default). Reboot once a month from the Lightsail console.

### 4.5 Set up the company and go live

1. Admin console → **Sites** → create the 5 real sites (each with its industry). That generates areas, categories, inspection templates and QR posters.
2. **Users** → import the CSV of real users; officers hand out enrolment codes to workers.
3. Print the QR posters **only now**, after the address is final.
4. Phones: install the Portal APK (GitHub Releases → newest `portal-v2.0.N`) → enter the production address → sign in.
5. Optional, needs your decision: `SMTP_URL` in `portal/.env` for e-mail reminders (re-run `install.sh` afterwards).

### 4.6 What to do with Render

Keep it as the test server. When its database expires (24 Nov), choose one:
- **Free:** in Render, delete the expired `safeworks-db`, then Blueprint → **Manual sync**. This creates a new free database, and `SEED_ON_START` re-seeds the demo company. Repeat every 30 days. *(Check the sync step in Render the first time.)*
- **Paid:** upgrade the database to the smallest paid plan (about US$6/month) so it never expires.
- **Neither:** let it expire. The production server is separate and isn't affected.

---

## 5. Costs, monthly

| Item | Cost |
|---|---|
| Lightsail 2 GB, Mumbai | US$12.00 |
| Automatic snapshots (~15–30 GB used) | ≈ US$1–2 |
| Static IP (attached) | US$0 |
| Data transfer (within 1.5 TB) | US$0 |
| **Subtotal** | ≈ US$13–14 + 18% GST ≈ **₹1,400/month** |
| Domain (only if a new one is bought) | ≈ ₹800–1,200/year |
| Render test server | ₹0 (free, recreated monthly) or ≈ US$6 |

When to move up to the 4 GB plan (US$24): if the server's memory stays above ~80% (Lightsail → Metrics) or reports feel slow during shift changes. Resizing is done from a snapshot and keeps the static IP.

---

## 6. Small repo fixes made with this plan

- `portal/deploy/install.sh`: the `--demo` summary named the 1.x sample logins (`SO-PS01-1`, `SUP-PS01-1`). It now names the 2.0 ones (`SO-TN1`, `WORKER-TN1-1`, …).
- `portal/docs/DECISIONS.md` #4: points to this plan.

## Sources (checked 3 Nov 2026)

- Lightsail bundles and Mumbai transfer allowance: https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html , https://aws.amazon.com/lightsail/faq/
- Render free database expiry and grace period: https://render.com/docs/free
- Oracle Always Free limits and idle reclaim: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
