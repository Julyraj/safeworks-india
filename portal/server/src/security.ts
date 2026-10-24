import crypto from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";

const scrypt = promisify(crypto.scrypt) as (pw: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// scrypt runs on the libuv thread pool, so hashing never blocks the event loop.
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// A hash that never matches, used to keep login timing equal for unknown employee IDs.
let dummyHash: string | null = null;
export async function dummyVerify(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword("not-a-real-password-0");
  await verifyPassword(password, dummyHash);
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Password rule: at least 8 characters with at least one letter and one number. */
export function passwordProblem(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.length > 128) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers.";
  return null;
}

/** Readable temporary password, e.g. "Kite-4827-Moss" (no look-alike characters). */
const WORDS = ["Bolt", "Crane", "Delta", "Ember", "Flint", "Grove", "Harbor", "Iron", "Jade", "Kite", "Lumen", "Maple", "Nova", "Onyx", "Pine", "Quartz", "Ridge", "Stone", "Tide", "Umber", "Vale", "Willow", "Yarrow", "Zinc", "Moss", "Brook", "Cedar", "Dune"];
export function tempPassword(): string {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  const num = String(crypto.randomInt(1000, 10000));
  return `${w()}-${num}-${w()}`;
}

export function signFile(key: string, exp: number): string {
  return crypto.createHmac("sha256", config.fileSigningSecret).update(`${key}|${exp}`).digest("base64url");
}

export function verifyFileSig(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signFile(key, exp));
  const got = Buffer.from(sig || "");
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

export function signedFileUrl(key: string): string {
  // Round expiry to 10 minutes so the same photo keeps the same URL for a while (browser cache friendly).
  const ttl = config.fileLinkTtlSeconds;
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.ceil((now + ttl) / 600) * 600;
  return `/files/${key}?e=${exp}&s=${signFile(key, exp)}`;
}
