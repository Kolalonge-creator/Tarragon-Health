import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC-SHA256 signing for outbound partner webhooks (§33.15). A partner
 * verifies `X-Tarragon-Signature: sha256=<hex>` against the raw body with
 * their own copy of partner_webhook_endpoints.secret — the same shape this
 * codebase already asks INBOUND wearable webhooks to prove
 * (lib/wearables/webhook-auth.ts's own HMAC verification, just the other
 * direction), so a partner receiving our events gets the same guarantee we
 * demand of Fitbit/WHOOP.
 */

export function signWebhookPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Exposed for a partner-facing test harness / docs example only — this
 * platform is always the signer for outbound webhooks, never the verifier,
 * so nothing in this codebase calls this at runtime. Kept alongside
 * signWebhookPayload so the two stay obviously symmetric for whoever writes
 * the partner-facing spec section. */
export function verifyWebhookSignature(secret: string, rawBody: string, presented: string): boolean {
  const expected = signWebhookPayload(secret, rawBody);
  const expectedBuf = Buffer.from(expected);
  const presentedBuf = Buffer.from(presented);
  if (expectedBuf.length !== presentedBuf.length) return false;
  return timingSafeEqual(expectedBuf, presentedBuf);
}
