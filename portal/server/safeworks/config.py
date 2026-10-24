"""Settings read from environment variables (same names as before, see .env.example)."""
from __future__ import annotations

import os
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parent.parent  # portal/server
PORTAL_ROOT = SERVER_ROOT.parent  # portal/
REPO_ROOT = PORTAL_ROOT.parent  # repository root (holds /data)


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name)
    if value is None or value == "":
        if default is None:
            raise RuntimeError(f"Missing environment variable {name}")
        return default
    return value


IS_PROD = os.environ.get("APP_ENV", os.environ.get("NODE_ENV", "")) == "production"


class Config:
    is_prod = IS_PROD
    port = int(env("PORT", "8080"))
    host = env("HOST", "0.0.0.0")
    database_url = env("DATABASE_URL", "postgres://safeworks:safeworks@127.0.0.1:5432/safeworks")
    db_pool_max = int(env("DB_POOL_MAX", "20"))
    storage_dir = Path(env("STORAGE_DIR", str(SERVER_ROOT / "storage"))).resolve()
    # "disk" (default) keeps photos in STORAGE_DIR; "db" keeps them in PostgreSQL (hosts without a persistent disk)
    storage_driver = "db" if env("STORAGE_DRIVER", "disk") == "db" else "disk"
    # Signs short-lived photo links. Must be a long random value in production.
    file_signing_secret = env("FILE_SIGNING_SECRET", None if IS_PROD else "dev-only-change-me-0123456789abcdef")
    file_link_ttl_seconds = int(env("FILE_LINK_TTL_SECONDS", "3600"))
    session_hours_portal = int(env("SESSION_HOURS_PORTAL", "12"))
    session_hours_admin = int(env("SESSION_HOURS_ADMIN", "8"))
    cors_origins = [s.strip() for s in env("CORS_ORIGINS", "https://localhost,capacitor://localhost,http://localhost:5173").split(",") if s.strip()]
    web_dist = Path(env("WEB_DIST", str(PORTAL_ROOT / "web" / "dist"))).resolve()
    data_dir = Path(env("DATA_DIR", str(REPO_ROOT / "data"))).resolve()
    smtp_url = os.environ.get("SMTP_URL", "")
    mail_from = env("MAIL_FROM", "SafeWorks <no-reply@safeworks.local>")
    public_url = env("PUBLIC_URL", os.environ.get("RENDER_EXTERNAL_URL") or "http://localhost:8080")
    trust_proxy = env("TRUST_PROXY", "false") == "true"
    run_jobs = env("RUN_JOBS", "true") == "true"
    auto_migrate = env("AUTO_MIGRATE", "true") != "false"
    log_level = env("LOG_LEVEL", "info" if IS_PROD else "warning")
    timezone = env("APP_TIMEZONE", "Asia/Kolkata")
    # Login protection
    max_failed_logins = int(env("MAX_FAILED_LOGINS", "5"))
    lock_minutes = int(env("LOCK_MINUTES", "15"))
    # Requests per minute per signed-in user (per server process)
    user_rate_limit = int(env("USER_RATE_LIMIT", "600"))
    max_photo_bytes = int(env("MAX_PHOTO_BYTES", str(3 * 1024 * 1024)))
    # Password hashing runs in worker threads so it never blocks other requests
    hash_threads = int(env("HASH_THREADS", "8"))
    # API requests slower than this are logged as warnings
    slow_ms = int(env("SLOW_MS", "1000"))


config = Config()
