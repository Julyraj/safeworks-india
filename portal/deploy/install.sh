#!/usr/bin/env bash
# SafeWorks Portal – one-command install or update on a fresh Ubuntu server
# (Oracle Cloud Always Free, AWS Lightsail, DigitalOcean, or a company server).
#
#   sudo bash portal/deploy/install.sh --demo          # test server with sample users and points
#   sudo bash portal/deploy/install.sh                 # empty company, only the ADMIN01 login
#
# Options:
#   --domain NAME          your own domain (its DNS must point at this server). Default: <public-ip>.sslip.io
#   --demo                 add sample users and about 180 sample points (first install only)
#   --company "NAME"       company name for the first install (can be changed later in Settings)
#   --admin-password PW    password for ADMIN01 (8+ characters, letters and numbers). Default: generated
#   --skip-https-check     do not wait for the HTTPS certificate at the end
#
# Running it again updates SafeWorks to the latest code and keeps all data, passwords and settings.
# What it does: installs Docker, opens ports 80/443 in the server firewall, writes portal/.env with random
# secrets, builds and starts SafeWorks + PostgreSQL + Caddy (HTTPS), creates the first login, and sets up a
# daily backup (/var/backups/safeworks, kept 7 days).
set -euo pipefail

PORTAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PORTAL/.env"
LOGIN_FILE=/root/safeworks-login.txt

DOMAIN=""
DEMO=false
COMPANY="SafeWorks Test Company"
ADMIN_PASSWORD=""
CHECK_HTTPS=true

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --demo) DEMO=true; shift ;;
    --company) COMPANY="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --skip-https-check) CHECK_HTTPS=false; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "Run with sudo:  sudo bash $0 $*"
[ -f "$PORTAL/docker-compose.yml" ] || die "Run this from the SafeWorks repository (portal/deploy/install.sh)."
if [ -n "$ADMIN_PASSWORD" ] && ! { [ ${#ADMIN_PASSWORD} -ge 8 ] && [[ "$ADMIN_PASSWORD" =~ [A-Za-z] ]] && [[ "$ADMIN_PASSWORD" =~ [0-9] ]]; }; then
  die "--admin-password needs 8+ characters with letters and numbers."
fi

# ---------------------------------------------------------------- 1. packages and Docker
say "Checking system packages"
if command -v apt-get >/dev/null 2>&1; then
  missing=""
  for p in curl git openssl cron; do command -v "$p" >/dev/null 2>&1 || missing="$missing $p"; done
  if [ -n "$missing" ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    # shellcheck disable=SC2086
    apt-get install -y -qq $missing ca-certificates >/dev/null
  fi
else
  warn "This script is tested on Ubuntu. Make sure curl, git, openssl, cron and Docker are installed."
fi

if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker (official script from get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker info >/dev/null 2>&1 || die "Docker is installed but not running."
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is missing (apt-get install docker-compose-plugin)."

# ---------------------------------------------------------------- 2. memory: add swap on small servers
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 1600 ] && [ "$(awk 'NR>1' /proc/swaps | wc -l)" -eq 0 ] && [ -w / ]; then
  say "Small server (${mem_mb} MB): adding a 2 GB swap file"
  if fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; then
    chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && \
      { grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab; } || warn "Could not enable swap."
  fi
fi

# ---------------------------------------------------------------- 3. server firewall (Oracle Cloud Ubuntu images block 80/443)
RULES=/etc/iptables/rules.v4
if [ -f "$RULES" ] && grep -q -- '-A INPUT -j REJECT' "$RULES"; then
  say "Opening ports 80 and 443 in the server firewall"
  for port in 80 443; do
    rule="-A INPUT -p tcp -m state --state NEW -m tcp --dport $port -j ACCEPT"
    grep -qF -- "$rule" "$RULES" || sed -i "/-A INPUT -j REJECT/i $rule" "$RULES"
    iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null || \
      iptables -I INPUT 1 -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  done
fi
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

# ---------------------------------------------------------------- 4. settings (portal/.env)
setenv() { # setenv KEY VALUE – replace or add a line in .env
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
getenv() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

if [ -z "$DOMAIN" ] && [ -f "$ENV_FILE" ]; then DOMAIN="$(getenv DOMAIN)"; fi
if [ -z "$DOMAIN" ]; then
  say "Finding this server's public IP address"
  ip="$(curl -fsS --max-time 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$ip" ] || ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Could not find the public IP. Run again with --domain <name>."
  DOMAIN="${ip//./-}.sslip.io"
fi

FIRST_INSTALL=false
if [ ! -f "$ENV_FILE" ]; then
  FIRST_INSTALL=true
  say "Writing settings to $ENV_FILE (random passwords and secrets)"
  cores=$(nproc 2>/dev/null || echo 1)
  workers=$(( cores >= 2 ? 2 : 1 ))
  shared=$(( mem_mb / 4 )); [ "$shared" -gt 1024 ] && shared=1024; [ "$shared" -lt 64 ] && shared=64
  umask 077
  cat > "$ENV_FILE" <<EOF
# SafeWorks settings, written by deploy/install.sh on $(date -u +%Y-%m-%d). Keep this file private.
COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.https.yml
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
FILE_SIGNING_SECRET=$(openssl rand -hex 32)
CORS_ORIGINS=https://localhost,capacitor://localhost
TRUST_PROXY=true
APP_BIND=127.0.0.1
WEB_CONCURRENCY=$workers
PG_SHARED_BUFFERS=${shared}MB
SEED_COMPANY=$COMPANY
SEED_ADMIN_ID=ADMIN01
# Email (optional), e.g. smtps://user:password@smtp.yourcompany.in:465 – without it emails stay queued
SMTP_URL=
MAIL_FROM=SafeWorks <no-reply@$DOMAIN>
EOF
  umask 022
else
  say "Keeping existing settings in $ENV_FILE"
  if [ "$(getenv DOMAIN)" != "$DOMAIN" ]; then
    setenv DOMAIN "$DOMAIN"; setenv PUBLIC_URL "https://$DOMAIN"
  fi
  grep -q '^COMPOSE_FILE=' "$ENV_FILE" || setenv COMPOSE_FILE "docker-compose.yml:deploy/docker-compose.https.yml"
fi
chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------- 5. build and start
say "Building and starting SafeWorks (the first build takes 5–10 minutes)"
cd "$PORTAL"
docker compose up -d --build --remove-orphans

say "Waiting for the server to start"
ok=false
for _ in $(seq 1 90); do
  if curl -fsS --max-time 3 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then ok=true; break; fi
  sleep 2
done
$ok || { docker compose logs --tail 50 app; die "SafeWorks did not start. The log is above."; }

# ---------------------------------------------------------------- 6. first login (and sample data)
if $FIRST_INSTALL; then
  [ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD="Sw$(openssl rand -hex 3)-$(openssl rand -hex 3)7"
  say "Creating the company, 5 pilot sites and the ADMIN01 login$($DEMO && echo ', plus sample users and points')"
  seed_args=()
  $DEMO && seed_args+=(--demo)
  docker compose exec -T -e SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" -e DEMO_PASSWORD="$ADMIN_PASSWORD" app python scripts/seed.py "${seed_args[@]}"
  umask 077
  {
    echo "SafeWorks login (written $(date -u +%Y-%m-%d) by install.sh)"
    echo "Address:        https://$DOMAIN"
    echo "Admin console:  https://$DOMAIN/admin/"
    echo "Admin login:    ADMIN01 / $ADMIN_PASSWORD"
    if $DEMO; then
      echo "Sample logins:  SO-PS01-1 (safety officer), SUP-PS01-1 (supervisor) … same password"
    fi
  } > "$LOGIN_FILE"
  umask 022
fi

# ---------------------------------------------------------------- 7. daily backup
say "Setting up a daily backup (03:00 India time, kept 7 days in /var/backups/safeworks)"
chmod +x "$PORTAL/deploy/backup.sh" "$PORTAL/deploy/restore.sh"
cat > /etc/cron.d/safeworks-backup <<EOF
# SafeWorks daily backup (21:30 UTC = 03:00 IST). Log: /var/log/safeworks-backup.log
30 21 * * * root $PORTAL/deploy/backup.sh >> /var/log/safeworks-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/safeworks-backup

# ---------------------------------------------------------------- 8. HTTPS check
https_ok=false
if $CHECK_HTTPS; then
  say "Waiting for the HTTPS certificate for $DOMAIN (up to 3 minutes)"
  for _ in $(seq 1 36); do
    if [ "$DOMAIN" = "localhost" ]; then
      curl -fsSk --max-time 5 "https://localhost/api/health" >/dev/null 2>&1 && { https_ok=true; break; }
    else
      curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1 && { https_ok=true; break; }
    fi
    sleep 5
  done
fi

# ---------------------------------------------------------------- done
echo
echo "================================================================"
if $https_ok; then
  echo " SafeWorks is running at  https://$DOMAIN"
else
  echo " SafeWorks is running. Its address will be  https://$DOMAIN"
  $CHECK_HTTPS && echo " HTTPS is not reachable yet: check that ports 80 and 443 are open in the cloud firewall"
  $CHECK_HTTPS && echo " (Oracle: VCN > Security List > Ingress Rules), then wait a minute and reload."
fi
echo " Admin console:  https://$DOMAIN/admin/"
if [ -f "$LOGIN_FILE" ]; then
  echo " Logins are saved in $LOGIN_FILE (show them with: sudo cat $LOGIN_FILE)"
fi
if $FIRST_INSTALL; then
  echo " Admin login:    ADMIN01 / $ADMIN_PASSWORD"
  $DEMO && echo " Sample logins:  SO-PS01-1 (safety officer), SUP-PS01-1 (supervisor), same password"
fi
echo " Update later:   cd $(dirname "$PORTAL") && git pull && sudo bash portal/deploy/install.sh"
echo "================================================================"
