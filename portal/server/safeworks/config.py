"""Settings read from environment variables (one line each in .env.example)."""
from __future__ import annotations

import os
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent.parent  # portal/server
PORTAL_ROOT = SERVER_ROOT.parent  # portal/
REPO_ROOT = PORTAL_ROOT.parent  # repository root (holds /data)

VERSION = "2.0.0"


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        if default is None:
            raise RuntimeError(f"Missing environment variable {name}")
        return default
    return value


IS_PROD = os.environ.get("APP_ENV", os.environ.get("NODE_ENV", "")) == "production"

# Dev-only defaults; production refuses to start without real values (see app.lifespan).
DEV_FILE_SECRET = "dev-only-change-me-0123456789abcdef"
DEV_FIELD_KEY = "ZGV2LW9ubHktZmllbGQta2V5LTAxMjM0NTY3ODk9PT0="  # base64 of 32 bytes


class Config:
    is_prod = IS_PROD
    version = VERSION
    port = int(env("PORT", "8080"))
    host = env("HOST", "0.0.0.0")
    database_url = env("DATABASE_URL", "postgres://safeworks:safeworks@127.0.0.1:5432/safeworks")
    db_pool_max = int(env("DB_POOL_MAX", "20"))
    storage_dir = Path(env("STORAGE_DIR", str(SERVER_ROOT / "storage"))).resolve()
    # "disk" (default) keeps files in STORAGE_DIR; "db" keeps them in PostgreSQL (hosts without a persistent disk)
    storage_driver = "db" if env("STORAGE_DRIVER", "disk") == "db" else "disk"
    # Signs short-lived file links, upload tickets and status links. Long random value in production.
    file_signing_secret = env("FILE_SIGNING_SECRET", None if IS_PROD else DEV_FILE_SECRET)
    file_link_ttl_seconds = int(env("FILE_LINK_TTL_SECONDS", "3600"))
    # AES-GCM key for phones, reporter contacts, anonymous seals and TOTP secrets (base64 of 32 random bytes).
    field_encryption_key = env("FIELD_ENCRYPTION_KEY", None if IS_PROD else DEV_FIELD_KEY)
    session_hours_field = int(env("SESSION_HOURS_FIELD", os.environ.get("SESSION_HOURS_PORTAL", "720")))
    session_hours_admin = int(env("SESSION_HOURS_ADMIN", "8"))
    preauth_minutes = 10
    cors_origins = [s.strip() for s in env("CORS_ORIGINS", "https://localhost,capacitor://localhost,http://localhost:5173").split(",") if s.strip()]
    web_dist = Path(env("WEB_DIST", str(PORTAL_ROOT / "web" / "dist"))).resolve()
    data_dir = Path(env("DATA_DIR", str(REPO_ROOT / "data"))).resolve()
    smtp_url = os.environ.get("SMTP_URL", "")
    mail_from = env("MAIL_FROM", "SafeWorks <no-reply@safeworks.local>")
    public_url = env("PUBLIC_URL", os.environ.get("RENDER_EXTERNAL_URL") or "http://localhost:8080").rstrip("/")
    trust_proxy = env("TRUST_PROXY", "false") == "true"
    run_jobs = env("RUN_JOBS", "true") == "true"
    auto_migrate = env("AUTO_MIGRATE", "true") != "false"
    log_level = env("LOG_LEVEL", "info" if IS_PROD else "warning")
    timezone = env("APP_TIMEZONE", "Asia/Kolkata")
    # Login protection
    max_failed_logins = int(env("MAX_FAILED_LOGINS", "10"))
    lock_minutes = int(env("LOCK_MINUTES", "15"))
    # Requests per minute per signed-in user (per server process)
    user_rate_limit = int(env("USER_RATE_LIMIT", "600"))
    # Media (photos, voice notes) accepted by PUT /media: 10 MB (brief §8.8)
    max_media_bytes = int(env("MAX_MEDIA_BYTES", str(10 * 1024 * 1024)))
    # Public QR form limits (brief §14.2)
    qr_per_token_hour = int(env("QR_PER_TOKEN_HOUR", "30"))
    qr_per_ip_hour = int(env("QR_PER_IP_HOUR", "10"))
    qr_max_payload = int(env("QR_MAX_PAYLOAD", str(15 * 1024 * 1024)))
    exports_per_hour = int(env("EXPORTS_PER_HOUR", "10"))
    # Password hashing runs in worker threads so it never blocks other requests
    hash_threads = int(env("HASH_THREADS", "8"))
    # API requests slower than this are logged as warnings
    slow_ms = int(env("SLOW_MS", "1000"))
    # Web Push (VAPID). When unset, push rows are marked failed with a clear error.
    vapid_public_key = os.environ.get("VAPID_PUBLIC_KEY", "")
    vapid_private_key = os.environ.get("VAPID_PRIVATE_KEY", "")
    vapid_subject = os.environ.get("VAPID_SUBJECT", "")
    # Salt for the public rate-limit IP hashes (24 h retention)
    ip_hash_salt = os.environ.get("IP_HASH_SALT", "") or (file_signing_secret or "")
    # Seeding (scripts/seed.py and start.sh)
    seed_org_name = os.environ.get("SEED_ORG_NAME") or os.environ.get("SEED_COMPANY") or "SafeWorks demo company"
    seed_admin_code = os.environ.get("SEED_ADMIN_ID", "ADMIN01")


config = Config()
