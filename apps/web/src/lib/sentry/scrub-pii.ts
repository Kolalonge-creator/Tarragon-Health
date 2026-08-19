import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Sentry's `sendDefaultPii` (unset here, default false) only governs
 * auto-attached IP/cookies/headers — it does nothing about PII embedded in
 * an error's own message or extra/context data. Postgres constraint
 * violations in particular ("Key (email)=(x@y.com) already exists") echo
 * the offending row value straight into the message text, and this app
 * throws plenty of raw Supabase/Postgres errors up to the Next.js error
 * boundary uncaught. This scrubs the common identifiable patterns
 * (email, E.164 phone, Nigerian NIN-shaped digit runs) out of every string
 * field on the event before it leaves the process.
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /\+?\d[\d\s-]{8,14}\d/g;

function scrubString(value: string): string {
  return value.replace(EMAIL_RE, "[redacted-email]").replace(PHONE_RE, "[redacted-phone]");
}

function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((item) => scrubDeep(item, depth + 1)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubDeep(val, depth + 1);
    }
    return out as T;
  }
  return value;
}

export function scrubPiiBeforeSend(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = scrubString(event.message);

  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) exception.value = scrubString(exception.value);
    }
  }

  if (event.extra) event.extra = scrubDeep(event.extra);
  if (event.contexts) event.contexts = scrubDeep(event.contexts);

  // Request bodies can be a full form submission (e.g. a failed patient
  // profile update) — drop rather than scrub, since structure varies too
  // much to trust a regex pass alone.
  if (event.request?.data) delete event.request.data;

  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) crumb.message = scrubString(crumb.message);
      if (crumb.data) crumb.data = scrubDeep(crumb.data);
    }
  }

  return event;
}
