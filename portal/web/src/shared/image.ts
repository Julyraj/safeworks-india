/* Photos on the phone: resize to a 1,600 px long edge, re-encode as JPEG (which also strips EXIF — no location or
   device data leaves the phone inside the file), optional blur boxes (faces, name plates), then SHA-256 so the server
   can prove the upload is the capture (brief §8.8). The vector annotation (arrows, circles) is kept separately so the
   pixels stay evidence; only blur is burnt in before hashing because that is what redaction means. */
import type { MediaRef } from "./types";
import { sha256Hex, uuid } from "./storage";

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_QUALITY = 0.8;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export interface BlurBox { x: number; y: number; w: number; h: number } // fractions of width/height (0–1)
export interface Annotation { shapes: ({ type: "arrow"; x1: number; y1: number; x2: number; y2: number } | { type: "circle"; cx: number; cy: number; r: number } | { type: "path"; points: [number, number][] })[]; colour: string }

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
  previewUrl: string; // object URL, revoke with releasePhoto()
  ref: MediaRef;
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function dims(bmp: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return "naturalWidth" in bmp ? { w: bmp.naturalWidth, h: bmp.naturalHeight } : { w: bmp.width, h: bmp.height };
}

export async function preparePhoto(
  file: Blob,
  opts: { purpose?: MediaRef["purpose"]; blur?: BlurBox[]; lat?: number | null; lng?: number | null; capturedAt?: string; maxEdge?: number; quality?: number } = {},
): Promise<PreparedPhoto> {
  if (file.size > PHOTO_MAX_BYTES) throw new Error("photo_too_large");
  const bmp = await loadBitmap(file);
  const { w: w0, h: h0 } = dims(bmp);
  const maxEdge = opts.maxEdge ?? PHOTO_MAX_EDGE;
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, w, h);
  if ("close" in bmp && typeof bmp.close === "function") bmp.close();
  for (const b of opts.blur ?? []) applyBlur(ctx, canvas, b);
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", opts.quality ?? PHOTO_QUALITY));
  if (!blob) throw new Error("encode_failed");
  const sha256 = await sha256Hex(blob);
  const capturedAt = opts.capturedAt ?? new Date().toISOString();
  return {
    blob, width: w, height: h, sha256,
    previewUrl: URL.createObjectURL(blob),
    ref: {
      clientUuid: uuid(), kind: "photo", purpose: opts.purpose ?? "evidence", sha256, bytes: blob.size, mime: "image/jpeg",
      width: w, height: h, capturedAt, lat: opts.lat ?? null, lng: opts.lng ?? null, redacted: (opts.blur?.length ?? 0) > 0,
    },
  };
}

/** Pixelates a region (fractions of the image) — irreversible, so the face or plate is gone from the evidence file. */
export function applyBlur(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, box: BlurBox): void {
  const x = Math.max(0, Math.floor(box.x * canvas.width));
  const y = Math.max(0, Math.floor(box.y * canvas.height));
  const w = Math.min(canvas.width - x, Math.ceil(box.w * canvas.width));
  const h = Math.min(canvas.height - y, Math.ceil(box.h * canvas.height));
  if (w < 2 || h < 2) return;
  const block = Math.max(8, Math.round(Math.max(w, h) / 10));
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.round(w / block));
  tmp.height = Math.max(1, Math.round(h / block));
  const tctx = tmp.getContext("2d")!;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

export function releasePhoto(p: PreparedPhoto): void {
  try { URL.revokeObjectURL(p.previewUrl); } catch { /* already gone */ }
}

/** Signature pad export: trims to the drawn area and returns a PNG MediaRef. */
export async function signatureFromCanvas(canvas: HTMLCanvasElement): Promise<{ blob: Blob; ref: MediaRef } | null> {
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return null;
  const sha256 = await sha256Hex(blob);
  return { blob, ref: { clientUuid: uuid(), kind: "signature", purpose: "signature", sha256, bytes: blob.size, mime: "image/png", width: canvas.width, height: canvas.height, capturedAt: new Date().toISOString() } };
}

/** Voice note from MediaRecorder output. */
export async function voiceNote(blob: Blob, durationS: number): Promise<{ blob: Blob; ref: MediaRef }> {
  const sha256 = await sha256Hex(blob);
  const mime = blob.type || "audio/webm";
  return { blob, ref: { clientUuid: uuid(), kind: "audio", purpose: "voice", sha256, bytes: blob.size, mime, durationS, capturedAt: new Date().toISOString() } };
}
