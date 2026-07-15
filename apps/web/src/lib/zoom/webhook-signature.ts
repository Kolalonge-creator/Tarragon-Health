/**
 * Reference implementation only — NOT imported by the webhook itself.
 *
 * supabase/functions/zoom-webhook/index.ts runs in an isolated Deno runtime
 * that can't import from apps/web, same reason as
 * lib/paystack/webhook-signature.ts. The Edge Function's copy of this logic
 * must match this algorithm exactly (Zoom's scheme: HMAC-SHA256 of
 * `v0:{timestamp}:{rawBody}`, keyed with ZOOM_WEBHOOK_SECRET_TOKEN, compared
 * against the `v0=` prefixed hex digest in the x-zm-signature header) — this
 * file exists so there's one canonical, type-checked, testable copy of the
 * algorithm to keep the Deno copy honest against.
 */
import { createHmac } from "node:crypto";

/** Verifies Zoom's `x-zm-signature` header against the raw body + timestamp header. */
export function verifyZoomSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  webhookSecretToken: string
): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const message = `v0:${timestampHeader}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", webhookSecretToken).update(message).digest("hex")}`;
  return signatureHeader === expected;
}
