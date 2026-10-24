// Resize and compress a photo on the phone before upload, and stamp it with
// date, time, site and observer (bottom band), as the observation record requires.

const MAX_SIDE = 1600;
const QUALITY = 0.8;

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as any);
    } catch {
      /* fall back */
    }
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

export async function compressPhoto(file: Blob, stamp: string): Promise<Blob> {
  const bmp = await loadBitmap(file);
  const w0 = "naturalWidth" in bmp ? bmp.naturalWidth : bmp.width;
  const h0 = "naturalHeight" in bmp ? bmp.naturalHeight : bmp.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, w, h);
  if ("close" in bmp && typeof bmp.close === "function") bmp.close();
  if (stamp) {
    const fs = Math.max(14, Math.round(w / 48));
    const band = Math.round(fs * 1.9);
    ctx.fillStyle = "rgba(15, 28, 43, 0.72)";
    ctx.fillRect(0, h - band, w, band);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${fs}px "Barlow", system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    let text = stamp;
    while (ctx.measureText(text).width > w - fs * 1.5 && text.length > 10) text = text.slice(0, -2);
    if (text !== stamp) text = text.slice(0, -1) + "…";
    ctx.fillText(text, Math.round(fs * 0.7), h - band / 2);
  }
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
  return blob ?? file;
}

export function stampText(site: string, observer: string): string {
  const now = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return `${now} · ${site} · ${observer}`;
}
