import { stripImageMetadata } from "@/lib/symptom-triage/strip-image-metadata";
import { detectResultDocType, verifyResultDocSignature } from "@/lib/validation/result-doc-signature";
import { stripWebpMetadata } from "./strip-webp-metadata";

/**
 * The one server-side step every patient or staff upload of a document or photo goes through before Storage (security audit
 * 2026-11-05, M-4/L-4):
 *
 * 1. The file's own first bytes must be the format it claims (PDF, JPEG, PNG, WEBP or HEIC). A renamed executable or HTML page
 *    is refused whatever its name or declared type.
 * 2. A JPEG, PNG or WEBP photo has its location, device and time metadata removed. The care team never needs where a photo was
 *    taken. A PDF is stored as it is; a HEIC photo is stored as it is (no parser here yet, and phones mostly send JPEG).
 *
 * When stripping a photo fails to parse it: with `requireClean` (anything served publicly, like a profile photo) the upload is
 * refused; otherwise the original is kept, so a real clinical report is never lost to an odd encoder.
 *
 * Not a malware scan. That needs an outside service and is a separate founder decision.
 */
export type PreparedUpload = { body: Uint8Array; contentType: string; locationStripped: boolean };

const XML_TYPES = new Set(["text/xml", "application/xml"]);

/** An ECG machine export: must open with an XML declaration and carry no HTML or script, which a browser could run. */
function looksLikeXmlExport(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 4096)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("<?xml") && !/<\s*(html|script)\b/i.test(head);
}

export async function prepareUpload(
  file: File,
  options: { requireClean?: boolean; allowXml?: boolean } = {}
): Promise<{ ok: true; upload: PreparedUpload } | { ok: false; error: string }> {
  if (options.allowXml && XML_TYPES.has(file.type)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeXmlExport(bytes)) return { ok: false, error: "That file is not a readable XML trace. Export it again from the machine." };
    return { ok: true, upload: { body: bytes, contentType: file.type, locationStripped: false } };
  }

  const signatureError = await verifyResultDocSignature(file);
  if (signatureError) return { ok: false, error: signatureError };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const actual = detectResultDocType(bytes.subarray(0, 1024)) ?? file.type;

  if (actual === "image/jpeg" || actual === "image/png") {
    const clean = stripImageMetadata(bytes);
    if (clean) return { ok: true, upload: { body: clean.bytes, contentType: clean.contentType, locationStripped: true } };
  } else if (actual === "image/webp") {
    const clean = stripWebpMetadata(bytes);
    if (clean) return { ok: true, upload: { body: clean, contentType: "image/webp", locationStripped: true } };
  } else {
    return { ok: true, upload: { body: bytes, contentType: actual, locationStripped: false } };
  }

  if (options.requireClean) return { ok: false, error: "That photo could not be read. Try a different photo." };
  return { ok: true, upload: { body: bytes, contentType: actual, locationStripped: false } };
}
