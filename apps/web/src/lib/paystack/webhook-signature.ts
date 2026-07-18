/**
 * Reference implementation only — NOT imported by the webhook itself.
 *
 * supabase/functions/paystack-webhook/index.ts runs in an isolated Deno
 * runtime that can't import from apps/web (same reason
 * supabase/functions/whatsapp-webhook/index.ts inlines its own SHA-256
 * check rather than sharing code with the Next.js app). The Edge Function's
 * copy of this logic must match this algorithm exactly (HMAC-SHA512, not
 * SHA-256 like WhatsApp's) — this file exists so there's one canonical,
 * type-checked, testable copy of the algorithm to keep the Deno copy
 * honest against, and so anything in apps/web that needs to verify a
 * Paystack signature (there currently isn't one) doesn't reinvent it.
 */
import { createHmac } from "node:crypto";

/** Verifies the `x-paystack-signature` header: HMAC-SHA512 of the raw
 * request body, keyed with PAYSTACK_WEBHOOK_SECRET, hex-encoded. */
export function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha512", webhookSecret).update(rawBody).digest("hex");
  return signatureHeader === expected;
}
