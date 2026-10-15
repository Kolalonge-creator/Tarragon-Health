import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * OQ-91: the signed link in the lab-request and care-plan emails (the PDF attachments are gone). The sender
 * (supabase/functions/_shared/notifications/delivery.ts, signDocumentLink) signs `kind.id.expiry` with HMAC-SHA256; this checks
 * it. The link proves the email came from us and has not expired; it opens nothing by itself. The route that uses it then
 * requires a signed-in session that owns the document, and the in-app PDF route checks ownership again.
 */
export type DocumentLinkKind = "lab-request" | "care-plan";
const KINDS: ReadonlySet<string> = new Set(["lab-request", "care-plan"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function verifyDocumentLink(
  secret: string | undefined,
  kind: string,
  id: string,
  expiry: string | null,
  signature: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!secret || !KINDS.has(kind) || !UUID.test(id) || !expiry || !signature || !/^\d{10,15}$/.test(expiry) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Number(expiry) < nowMs) return false;
  const expected = createHmac("sha256", secret).update(`${kind}.${id}.${expiry}`).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Where a verified, signed-in owner is sent: the existing in-app PDF routes, which check ownership themselves. */
export function documentTarget(kind: DocumentLinkKind, id: string): string {
  return kind === "lab-request" ? `/api/patient/lab-order/${id}/request` : "/api/patient/preventive-care-plan";
}
