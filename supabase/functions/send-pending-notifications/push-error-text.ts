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
