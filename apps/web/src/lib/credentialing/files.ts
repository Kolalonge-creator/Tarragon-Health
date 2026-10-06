/**
 * Upload checks for credential documents (S15). A file is accepted only when its first bytes say it is what it
 * claims to be, so a renamed executable or a script cannot ride in under a PDF extension. The bucket, the
 * database function and this check all agree on the same four types.
 */
export type DocumentFileType = { ext: "pdf" | "jpg" | "png" | "webp"; mime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" };

const MIME_ALIASES: Record<string, DocumentFileType["mime"]> = {
  "application/pdf": "application/pdf",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** The type the bytes actually are, or null when they are none of the accepted types. */
export function detectDocumentType(bytes: Uint8Array): DocumentFileType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: "pdf", mime: "application/pdf" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", mime: "image/png" };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export type UploadCheck = { ok: true; type: DocumentFileType } | { ok: false; error: string };

export function checkDocumentUpload(input: { bytes: Uint8Array; claimedMime: string; maxBytes: number }): UploadCheck {
  const { bytes, claimedMime, maxBytes } = input;
  if (bytes.length === 0) return { ok: false, error: "That file is empty. Choose the file again." };
  if (bytes.length > maxBytes) {
    return { ok: false, error: `That file is too large. The most we can take is ${Math.floor(maxBytes / 1024 / 1024)} MB.` };
  }
  const detected = detectDocumentType(bytes);
  if (!detected) return { ok: false, error: "We can only take a PDF, JPG, PNG or WebP file." };
  const claimed = MIME_ALIASES[claimedMime.toLowerCase()];
  if (!claimed || claimed !== detected.mime) {
    return { ok: false, error: "The file type does not match the file. Choose the original file." };
  }
  return { ok: true, type: detected };
}
