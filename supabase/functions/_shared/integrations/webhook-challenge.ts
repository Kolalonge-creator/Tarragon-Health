/**
 * The vendor's one-time webhook URL handshake answers with an HMAC of the challenge under the SAME secret that signs real events. An
 * unchecked challenge is therefore an oracle: sending `v0:<timestamp>:<forged body>` would return the exact signature for that forged
 * event. A real challenge is a plain token. What matters is what it must NOT be, so this is a denylist (no colon, no whitespace, at most
 * 256 characters); Zoom's token alphabet is not documented and refusing a real challenge would stop the subscription from activating.
 * Shared by the web route and the edge function so the two cannot drift.
 */
const SHAPE = /^[^\s:]{1,256}$/;

export function isSafeWebhookChallenge(token: unknown): token is string {
  return typeof token === "string" && SHAPE.test(token);
}
