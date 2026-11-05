// What to store in notifications.last_error when a web push send fails. The library message alone ("Received unexpected response code")
// hides why: the HTTP status and the push service's own reason (Apple answers with {"reason":"..."}, FCM with a short text) are the
// diagnosis. The body comes from the push service about our own request, never from a patient, and is capped so a verbose response
// cannot bloat the row.

const MAX_BODY_CHARS = 200;

export function describePushError(err: unknown): string {
  const base = err instanceof Error ? err.message : "unknown error";
  const e = err as { statusCode?: unknown; body?: unknown } | null;
  const status = typeof e?.statusCode === "number" ? e.statusCode : null;
  const body = typeof e?.body === "string" ? e.body.replace(/\s+/g, " ").trim().slice(0, MAX_BODY_CHARS) : "";
  if (status === null) return base;
  return body ? `${base} (HTTP ${status}: ${body})` : `${base} (HTTP ${status})`;
}

// A web push subscription the push service will never accept again, so the sender should disable the row instead of retrying it on
// every page. 404/410: the browser revoked or expired it. A subscription is also bound to the VAPID key it was made with: after the
// 2026-09-24 key rotation Apple answered 400 {"reason":"VapidPkHashMismatch"} and FCM 403 "the VAPID credentials ... do not
// correspond", every day, for a doctor's phone that still held an old-key subscription. Those can never succeed either; the device
// re-subscribes with the current key the next time the app opens (PR #1627). A plain 400/403 with any other reason is NOT dead.
export function isDeadWebPushSubscription(err: unknown): boolean {
  const e = err as { statusCode?: unknown; body?: unknown } | null;
  const status = typeof e?.statusCode === "number" ? e.statusCode : null;
  if (status === 404 || status === 410) return true;
  const body = typeof e?.body === "string" ? e.body : "";
  if (status === 400 && /VapidPkHashMismatch/.test(body)) return true;
  if (status === 403 && /VAPID credentials[\s\S]*do not correspond/i.test(body)) return true;
  return false;
}
