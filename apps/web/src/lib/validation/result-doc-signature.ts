import { RESULT_DOC_MIME_TYPES, type ResultDocMime } from "./lab-result-documents";

/**
 * Tarragon Health 2.0, Phase 1 (T2-04): the type a browser declares for an upload is whatever the client says it is, and
 * validateResultDocFile only checks that declaration. Before a lab report is stored, and before any of it is sent to the
 * AI reader, the file's own first bytes must show it really is the format it claims. A file that is not a PDF or a photo
 * (an executable, an HTML page, a script renamed to .pdf) is refused here, on the server, whatever its name or type.
 *
 * This is a format check, not a malware scan: a real PDF can still carry a harmful payload. It closes the cheapest attack
 * (anything uploaded under a trusted type) and keeps a malformed file away from the extractor. A full scan is a separate
 * vendor decision.
 */

const HEAD_BYTES = 1024;

/** ISO base media brands a HEIC/HEIF photo is written with (ftyp box at offset 4). */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** The format the bytes actually are, or null when they are none of the accepted ones. */
export function detectResultDocType(head: Uint8Array): ResultDocMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (
    head.length >= 8 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) {
    return "image/png";
  }
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "image/webp";
  if (head.length >= 12 && ascii(head, 4, 4) === "ftyp" && HEIC_BRANDS.has(ascii(head, 8, 4))) return "image/heic";
  // PDF readers accept the header anywhere in the first 1024 bytes (some scanners prepend a few bytes).
  if (ascii(head, 0, Math.min(head.length, HEAD_BYTES)).includes("%PDF-")) return "application/pdf";
  return null;
}

/**
 * Server-side: null when the file's bytes match its declared type, otherwise the message to show. Call it after
 * validateResultDocFile (which checks the declared type and size) and before the file is stored.
 */
export async function verifyResultDocSignature(file: Blob & { type: string }): Promise<string | null> {
  const declared = file.type;
  if (!(RESULT_DOC_MIME_TYPES as readonly string[]).includes(declared)) {
    return "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the result";
  }
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const actual = detectResultDocType(head);
  if (actual === declared) return null;
  if (actual === null) {
    return "That file is not a readable PDF or photo. Save the result as a PDF or take a photo, then upload it again";
  }
  // A real accepted format under the wrong label (for example a PNG named .jpg) is still a real report: accept it only
  // when it is the same kind of file (photo for photo). A photo labelled as a PDF, or the reverse, is refused.
  const isImage = (t: string) => t.startsWith("image/");
  if (isImage(actual) && isImage(declared)) return null;
  return "That file is not what it says it is. Save the result as a PDF or take a photo, then upload it again";
}
