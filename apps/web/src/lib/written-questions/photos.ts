export const PHOTO_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const PHOTO_MAX_WIDTH = 1600;

export type PhotoCheck = { ok: true } | { ok: false; reason: "limit" | "type" | "size" };

/** Check one picked photo against the published limits before it is compressed or kept. */
export function checkPhoto(
  file: { type: string; size: number },
  currentCount: number,
  limits: { maxPhotos: number; maxBytes: number }
): PhotoCheck {
  if (currentCount >= limits.maxPhotos) return { ok: false, reason: "limit" };
  if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(file.type.toLowerCase())) return { ok: false, reason: "type" };
  if (file.size > limits.maxBytes) return { ok: false, reason: "size" };
  return { ok: true };
}

/** Never upscale; scale down to at most `maxWidth` wide, keeping the aspect ratio. */
export function targetSize(width: number, height: number, maxWidth: number = PHOTO_MAX_WIDTH): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Resize on the device and re-encode as JPEG. Drawing to a canvas drops EXIF, so location data never leaves the phone.
 * Browser only.
 */
export async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85);
    });
  } finally {
    bitmap.close();
  }
}
