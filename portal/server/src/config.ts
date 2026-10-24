import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback === undefined) throw new Error(`Missing environment variable ${name}`);
    return fallback;
  }
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(env("PORT", "8080")),
  host: env("HOST", "0.0.0.0"),
  databaseUrl: env("DATABASE_URL", "postgres://safeworks:safeworks@127.0.0.1:5432/safeworks"),
  dbPoolMax: Number(env("DB_POOL_MAX", "20")),
  storageDir: path.resolve(env("STORAGE_DIR", path.join(serverRoot, "storage"))),
  // "disk" (default) keeps photos in STORAGE_DIR; "db" keeps them in PostgreSQL (hosts without a persistent disk)
  storageDriver: env("STORAGE_DRIVER", "disk") === "db" ? ("db" as const) : ("disk" as const),
  // Secret used to sign short-lived photo links. Must be set to a long random value in production.
  fileSigningSecret: env("FILE_SIGNING_SECRET", isProd ? undefined : "dev-only-change-me-0123456789abcdef"),
  fileLinkTtlSeconds: Number(env("FILE_LINK_TTL_SECONDS", "3600")),
  sessionHoursPortal: Number(env("SESSION_HOURS_PORTAL", "12")),
  sessionHoursAdmin: Number(env("SESSION_HOURS_ADMIN", "8")),
  corsOrigins: env("CORS_ORIGINS", "https://localhost,capacitor://localhost,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  webDist: path.resolve(env("WEB_DIST", path.join(serverRoot, "..", "web", "dist"))),
  libraryDir: path.resolve(env("LIBRARY_DIR", path.join(serverRoot, "..", "..", ""))),
  smtpUrl: process.env.SMTP_URL || "",
  mailFrom: env("MAIL_FROM", "SafeWorks <no-reply@safeworks.local>"),
  publicUrl: env("PUBLIC_URL", process.env.RENDER_EXTERNAL_URL || "http://localhost:8080"),
  trustProxy: env("TRUST_PROXY", "false") === "true",
  runJobs: env("RUN_JOBS", "true") === "true",
  logLevel: env("LOG_LEVEL", isProd ? "info" : "warn"),
  timezone: env("APP_TIMEZONE", "Asia/Kolkata"),
  // Login protection
  maxFailedLogins: Number(env("MAX_FAILED_LOGINS", "5")),
  lockMinutes: Number(env("LOCK_MINUTES", "15")),
  // Request limit per signed-in user (requests per minute)
  userRateLimit: Number(env("USER_RATE_LIMIT", "600")),
  maxPhotoBytes: Number(env("MAX_PHOTO_BYTES", String(3 * 1024 * 1024))),
};

export type Config = typeof config;
