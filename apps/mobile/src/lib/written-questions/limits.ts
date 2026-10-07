import type { MessageKey } from "@tarragon/i18n";

export const QUESTION_MIN_CHARS = 10;
export const QUESTION_MAX_CHARS = 2000;
export const DURATION_MAX_CHARS = 200;

/** Fallbacks used until the allowance call says otherwise (the server value wins). */
export const DEFAULT_MAX_PHOTOS = 3;
export const DEFAULT_MAX_PHOTO_BYTES = 8_388_608;

export type QuestionCheck = { ok: true } | { ok: false; key: MessageKey };

export function checkQuestionLength(question: string): QuestionCheck {
  const length = question.trim().length;
  if (length < QUESTION_MIN_CHARS) return { ok: false, key: "wq.error.length" };
  if (length > QUESTION_MAX_CHARS) return { ok: false, key: "wq.error.generic" };
  return { ok: true };
}

export type PhotoCheck = { ok: true } | { ok: false; reason: "limit" | "too_big" | "empty" };

export function checkPhotoAdd(currentCount: number, bytes: number, maxPhotos: number, maxBytes: number): PhotoCheck {
  if (currentCount >= maxPhotos) return { ok: false, reason: "limit" };
  if (bytes <= 0) return { ok: false, reason: "empty" };
  if (bytes > maxBytes) return { ok: false, reason: "too_big" };
  return { ok: true };
}

/** `<userId>/<consultId>/<uuid>.jpg`, the only path shape the bucket policy accepts. */
export function photoStoragePath(userId: string, consultId: string, photoId: string): string {
  return `${userId}/${consultId}/${photoId}.jpg`;
}

/**
 * Removes the metadata segments from a JPEG (EXIF/GPS in APP1, IPTC in APP13,
 * comments), keeping the picture. expo-image-picker re-encodes with a quality
 * setting but is not guaranteed to drop location data, and expo-image-manipulator
 * is not installed, so this runs on the bytes themselves. Returns null when the
 * bytes are not a well formed JPEG, so a bad file is refused rather than sent.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let i = 2;
  while (i < input.length) {
    if (input[i] !== 0xff) return null;
    // Skip fill bytes.
    while (i < input.length && input[i] === 0xff) i += 1;
    const marker = input[i];
    if (marker === undefined) return null;
    i += 1;
    if (marker === 0xd9) {
      parts.push(Uint8Array.of(0xff, 0xd9));
      break;
    }
    // Standalone markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (i + 2 > input.length) return null;
    const length = (input[i] << 8) | input[i + 1];
    if (length < 2 || i + length > input.length) return null;
    if (marker === 0xda) {
      // Start of scan: the rest of the file is entropy-coded image data.
      parts.push(Uint8Array.of(0xff, marker));
      parts.push(input.subarray(i));
      i = input.length;
      break;
    }
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe || (marker >= 0xe3 && marker <= 0xef && marker !== 0xee);
    if (!drop) {
      parts.push(Uint8Array.of(0xff, marker));
      parts.push(input.subarray(i, i + length));
    }
    i += length;
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
