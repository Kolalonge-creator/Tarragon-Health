import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Signed, unauthenticated-friendly links for broadcast emails: one-click
// unsubscribe, and open/click tracking. Mirrors
// apps/web/src/lib/wearables/state-token.ts's HMAC shape (createHmac +
// timingSafeEqual), but with its own dedicated secret (BROADCAST_LINK_SECRET)
// rather than reusing SUPABASE_SERVICE_ROLE_KEY — these links are mailed out
// and can sit in an inbox for months, unlike the wearables OAuth state's
// 10-minute round-trip, so they deserve a secret that can be rotated
// independently of the service-role key.
//
// Every signed message is namespaced by purpose ("unsub:<profileId>",
// "open:<notificationId>", "click:<notificationId>:<url>") so a token minted
// for one purpose can never be replayed as another — in particular, a click
// token signs the destination URL itself, so a valid signature can't be
// reused to redirect somewhere the admin never set.
//
// Deliberately no expiry: unlike the wearables OAuth state (a same-request
// round-trip), these links are mailed out and must keep working whenever the
// recipient opens the email, days or months later.

function signingSecret(): string {
  return process.env.BROADCAST_LINK_SECRET ?? "";
}

/** True only when a real secret is configured — every caller must check this
 * before trusting sign()/verify() (an empty secret would make every token
 * signed with the same empty key "valid", which is never should be trusted). */
export function hasBroadcastLinkSecret(): boolean {
  return signingSecret().length > 0;
}

function sign(message: string): string {
  return createHmac("sha256", signingSecret()).update(message).digest("base64url");
}

/** Builds a `<message>.<signature>` token for the given namespaced message, or
 * null when BROADCAST_LINK_SECRET isn't configured — never signs with an
 * empty/missing secret, which would make every token "valid" against itself
 * but forgeable by anyone. Not currently called from apps/web itself (only
 * the Edge Function mints these tokens; this app only verifies them) — kept
 * as the symmetric counterpart to verifyBroadcastLinkToken and exercised
 * directly in link-token.test.ts. */
export function signBroadcastLinkMessage(message: string): string | null {
  if (!hasBroadcastLinkSecret()) return null;
  return `${message}.${sign(message)}`;
}

/**
 * Verifies a `<message>.<signature>` token against the expected namespaced
 * message (the caller reconstructs the exact message it expects — e.g.
 * `unsub:${profileId}` — so this never trusts a message embedded in the
 * token itself, only that the signature matches the message the caller
 * already knows to expect).
 */
export function verifyBroadcastLinkToken(token: string | null, expectedMessage: string): boolean {
  if (!token || !hasBroadcastLinkSecret()) return false;
  const expectedSignature = sign(expectedMessage);
  const providedToken = `${expectedMessage}.${expectedSignature}`;
  if (token.length !== providedToken.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(providedToken));
}
