import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { config } from "./config.js";
import { badRequest } from "./errors.js";
import { pool } from "./db.js";

/**
 * Photo storage. Phase 1 keeps files on the server disk (STORAGE_DIR), or inside PostgreSQL
 * when STORAGE_DRIVER=db (for hosts without a persistent disk, e.g. a free test server).
 * The interface is small so an S3-compatible store can replace it when hosting is decided.
 */
export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  open(key: string): Promise<Readable | null>;
  remove(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_\-.]{0,200}$/;

function resolveKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw badRequest("Invalid file key.");
  const full = path.resolve(config.storageDir, key);
  if (!full.startsWith(config.storageDir + path.sep)) throw badRequest("Invalid file key.");
  return full;
}

const dbStorage: Storage = {
  async put(key, data, mime) {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw badRequest("Invalid file key.");
    await pool.query(`insert into file_blobs (key, mime, data) values ($1, $2, $3) on conflict (key) do update set data = excluded.data, mime = excluded.mime`, [key, mime, data]);
  },
  async open(key) {
    if (!SAFE_KEY.test(key)) return null;
    const r = await pool.query<{ data: Buffer }>(`select data from file_blobs where key = $1`, [key]);
    return r.rows[0] ? Readable.from([r.rows[0].data]) : null;
  },
  async remove(key) {
    await pool.query(`delete from file_blobs where key = $1`, [key]);
  },
};

const diskStorage: Storage = {
  async put(key, data) {
    const full = resolveKey(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, full);
  },
  async open(key) {
    let full: string;
    try {
      full = resolveKey(key);
    } catch {
      return null;
    }
    try {
      await fsp.access(full);
    } catch {
      return null;
    }
    return fs.createReadStream(full);
  },
  async remove(key) {
    try {
      await fsp.unlink(resolveKey(key));
    } catch {
      /* already gone */
    }
  },
};

export const storage: Storage = config.storageDriver === "db" ? dbStorage : diskStorage;

export interface ImageInfo {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
  width: number | null;
  height: number | null;
}

/** Identify an image by its magic bytes (never trust the browser's content type). */
export function sniffImage(buf: Buffer): ImageInfo | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dim = jpegSize(buf);
    return { mime: "image/jpeg", ext: "jpg", width: dim?.[0] ?? null, height: dim?.[1] ?? null };
  }
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp", width: null, height: null };
  }
  return null;
}

function jpegSize(buf: Buffer): [number, number] | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  return null;
}

export function photoKey(ext: string): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `obs/${y}/${m}/${crypto.randomUUID()}.${ext}`;
}
