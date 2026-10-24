import type { FastifyRequest } from "fastify";
import { config } from "./config.js";
import { badRequest } from "./errors.js";
import { ImageInfo, photoKey, sniffImage, storage } from "./storage.js";

export interface UploadedImage {
  buf: Buffer;
  info: ImageInfo;
}

export async function readMultipart(
  req: FastifyRequest,
  opts: { fileFields: string[]; maxFiles: number },
): Promise<{ data: any; files: Record<string, UploadedImage[]> }> {
  if (!req.isMultipart()) throw badRequest("Expected a form upload (multipart/form-data).");
  const files: Record<string, UploadedImage[]> = {};
  let data: any = {};
  const parts = req.parts({ limits: { fileSize: config.maxPhotoBytes, files: opts.maxFiles, fields: 10, fieldSize: 256 * 1024 } });
  for await (const part of parts) {
    if (part.type === "file") {
      const buf = await part.toBuffer();
      if (!opts.fileFields.includes(part.fieldname)) continue;
      const info = sniffImage(buf);
      if (!info) throw badRequest("Only JPEG, PNG or WebP photos are accepted.");
      (files[part.fieldname] ||= []).push({ buf, info });
    } else if (part.fieldname === "data") {
      try {
        data = JSON.parse(String(part.value));
      } catch {
        throw badRequest("Form data is not valid JSON.");
      }
    }
  }
  return { data, files };
}

export interface StoredPhoto {
  key: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export async function storePhotos(images: UploadedImage[]): Promise<StoredPhoto[]> {
  const out: StoredPhoto[] = [];
  try {
    for (const img of images) {
      const key = photoKey(img.info.ext);
      await storage.put(key, img.buf, img.info.mime);
      out.push({ key, mime: img.info.mime, bytes: img.buf.length, width: img.info.width, height: img.info.height });
    }
  } catch (e) {
    await discardPhotos(out);
    throw e;
  }
  return out;
}

export async function discardPhotos(photos: StoredPhoto[]): Promise<void> {
  await Promise.all(photos.map((p) => storage.remove(p.key)));
}
