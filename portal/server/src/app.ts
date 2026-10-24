import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { sha256, verifyFileSig } from "./security.js";
import { storage } from "./storage.js";
import authRoutes from "./routes/auth.js";
import metaRoutes from "./routes/meta.js";
import observationRoutes from "./routes/observations.js";
import dashboardRoutes from "./routes/dashboard.js";
import adminRoutes from "./routes/admin.js";

const STRICT_CSP =
  "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
  "connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
// The bundled SafeWorks library is a single self-contained page with inline script.
const LIBRARY_CSP =
  "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'self'; object-src 'none'";

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: config.logLevel } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    requestTimeout: 120_000,
    keepAliveTimeout: 65_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.userRateLimit,
    timeWindow: "1 minute",
    allowList: (req) => !req.url.startsWith("/api/"),
    keyGenerator: (req) => {
      const h = req.headers.authorization;
      return h && h.startsWith("Bearer ") ? `u:${sha256(h.slice(7)).slice(0, 24)}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: `Too many requests. Please wait ${Math.ceil(ctx.ttl / 1000)} seconds.`, code: "rate_limited" }),
  });
  await app.register(multipart, { limits: { fileSize: config.maxPhotoBytes, files: 4, fields: 10, fieldSize: 256 * 1024 } });

  app.addHook("onSend", async (req, reply, payload) => {
    const ct = String(reply.getHeader("content-type") ?? "");
    if (ct.includes("text/html")) {
      reply.header("Content-Security-Policy", req.url.startsWith("/library/") ? LIBRARY_CSP : STRICT_CSP);
      reply.header("Cache-Control", "no-cache");
    }
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message, code: err.code, details: err.details });
      return;
    }
    const code = err?.code as string | undefined;
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      reply.code(413).send({ error: `A photo is too large (limit ${Math.round(config.maxPhotoBytes / 1024 / 1024)} MB).`, code: "too_large" });
      return;
    }
    if (code === "FST_FILES_LIMIT" || code === "FST_PARTS_LIMIT") {
      reply.code(413).send({ error: "Too many photos in one upload.", code: "too_many_files" });
      return;
    }
    if (err?.statusCode === 429) {
      reply.code(429).send({ error: err.message || "Too many requests.", code: "rate_limited" });
      return;
    }
    if (err?.validation || code === "FST_ERR_CTP_INVALID_JSON_BODY" || code === "FST_ERR_CTP_EMPTY_JSON_BODY" || err?.statusCode === 400) {
      reply.code(400).send({ error: err.message || "Bad request.", code: "bad_request" });
      return;
    }
    if (err?.statusCode === 413) {
      reply.code(413).send({ error: "The upload is too large.", code: "too_large" });
      return;
    }
    if (err?.statusCode === 415) {
      reply.code(415).send({ error: "Unsupported content type.", code: "unsupported" });
      return;
    }
    req.log.error(err);
    if (!opts.logger) console.error("[error]", req.method, req.url, err?.message ?? err);
    reply.code(500).send({ error: "Something went wrong on the server. Please try again.", code: "server_error" });
  });

  await app.register(authRoutes);
  await app.register(metaRoutes);
  await app.register(observationRoutes);
  await app.register(dashboardRoutes);
  await app.register(adminRoutes);

  // Signed photo links: /files/obs/2026/10/<uuid>.jpg?e=<expiry>&s=<signature>
  app.get("/files/*", async (req, reply) => {
    const key = (req.params as any)["*"] as string;
    const { e, s } = req.query as { e?: string; s?: string };
    if (!verifyFileSig(key, Number(e), String(s ?? ""))) {
      reply.code(403).send({ error: "This photo link has expired. Refresh the page.", code: "link_expired" });
      return;
    }
    const stream = await storage.open(key);
    if (!stream) {
      reply.code(404).send({ error: "Photo not found.", code: "not_found" });
      return;
    }
    const ext = key.split(".").pop() ?? "";
    reply.header("Content-Type", MIME[ext] ?? "application/octet-stream");
    reply.header("Cache-Control", "private, max-age=3600, immutable");
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(stream);
  });

  // Web front ends (built by `npm run build -w web`): portal at /, admin console at /admin/, library at /library/
  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: "/",
      index: ["index.html"],
      wildcard: true,
      setHeaders: (res: any, filePath: string) => {
        const set = (k: string, v: string) => (typeof res.setHeader === "function" ? res.setHeader(k, v) : res.header(k, v));
        if (filePath.includes(`${path.sep}assets${path.sep}`)) set("Cache-Control", "public, max-age=31536000, immutable");
        else if (filePath.endsWith("sw.js")) set("Cache-Control", "no-cache");
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split("?")[0];
    if (req.method === "GET" && !url.startsWith("/api/") && !url.startsWith("/files/") && fs.existsSync(config.webDist) && !path.extname(url)) {
      const page = url.startsWith("/admin") ? "admin/index.html" : url.startsWith("/library") ? "library/index.html" : "index.html";
      reply.type("text/html").sendFile(page);
      return;
    }
    reply.code(404).send({ error: "Not found.", code: "not_found" });
  });

  return app;
}
