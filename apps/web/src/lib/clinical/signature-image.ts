/**
 * A doctor's signature image: what may be uploaded, and the check that what comes back out of storage is really an image.
 *
 * Only PNG and JPEG: the PDF library cannot embed WebP. 1 MB maximum (the bucket enforces the same limit). The magic-byte
 * check runs again when the PDF is built, so a file renamed to .png that is not a PNG is never handed to the renderer.
 */
export const SIGNATURE_MAX_BYTES = 1_048_576;
export const SIGNATURE_BUCKET = "staff-signatures";

export type SignatureFormat = "png" | "jpg";

export type SignatureValidation =
  | { status: "ok"; format: SignatureFormat; contentType: "image/png" | "image/jpeg" }
  | { status: "error"; message: string };

export function validateSignatureFile(file: { type: string; size: number }): SignatureValidation {
  if (file.size <= 0) return { status: "error", message: "That file is empty." };
  if (file.size > SIGNATURE_MAX_BYTES) return { status: "error", message: "The signature image must be 1 MB or smaller." };
  if (file.type === "image/png") return { status: "ok", format: "png", contentType: "image/png" };
  if (file.type === "image/jpeg") return { status: "ok", format: "jpg", contentType: "image/jpeg" };
  return { status: "error", message: "Use a PNG or JPG image." };
}

/** '<organisation_id>/<uuid>.<ext>': the folder is what the bucket's policies check. */
export function signatureObjectPath(organisationId: string, uuid: string, format: SignatureFormat): string {
  return `${organisationId}/${uuid}.${format}`;
}

/** The image format a byte buffer really is, or null. */
export function sniffImageFormat(bytes: Uint8Array): SignatureFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

/** A data URL the PDF renderer can embed, or null when the bytes are not a PNG or JPEG. */
export function signatureDataUrl(bytes: Uint8Array): string | null {
  const format = sniffImageFormat(bytes);
  if (!format) return null;
  const mime = format === "png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
