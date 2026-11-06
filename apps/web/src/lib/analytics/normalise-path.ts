/**
 * What a page view may say about where a person went.
 *
 * `web_events` rows carry the signed-in `profile_id`, so a stored path is a statement about that person. Two things must not
 * be in it (patient dashboard 2.0, spec section 24/26: no identifiable clinical information in product analytics):
 *
 * 1. Record identifiers. A UUID or long number in a path (`/patient/consultation/<id>`, `/clinician/patients/<id>`) names a
 *    specific record or patient. They become `:id`, which also makes the "top pages" report group properly.
 * 2. Sensitive topics. Visiting the sexual health, cycle, contraception, pregnancy, fertility, mental wellbeing, self-help,
 *    journal or alcohol pages says something about a person's health on its own (the reproductive and mental health categories
 *    the platform treats as protected). Those are counted under one bucket, `/patient/(private)`, so usage can still be
 *    measured in total without naming the topic against a person.
 *
 * Query strings and fragments are dropped; the tracker sends none, but the route does not trust that.
 */

const PRIVATE_BUCKET = "/patient/(private)";

/** First path segment under /patient whose very name is health information about the visitor. */
const SENSITIVE_PATIENT_SEGMENTS = new Set([
  "sexual-health",
  "cycle",
  "contraception",
  "pregnancy",
  "fertility",
  "womens-health",
  "wellbeing",
  "self-help",
  "symptom-journal",
  "diary",
  "alcohol",
  "mental-health",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_NUMBER = /^\d{4,}$/;
/** Opaque tokens (invite links, verification codes): long, mixed letters and digits. */
const OPAQUE_TOKEN = /^(?=.*\d)(?=.*[a-z])[a-z0-9_-]{20,}$/i;

export function normaliseTrackedPath(raw: string): string {
  const withoutQuery = raw.split(/[?#]/, 1)[0] ?? "";
  const segments = withoutQuery.split("/").filter((s) => s.length > 0);

  if (segments[0] === "patient" && segments[1] !== undefined && SENSITIVE_PATIENT_SEGMENTS.has(segments[1].toLowerCase())) {
    return PRIVATE_BUCKET;
  }

  const cleaned = segments.map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // keep the raw segment; it is still checked below
    }
    if (UUID.test(decoded) || LONG_NUMBER.test(decoded) || OPAQUE_TOKEN.test(decoded)) return ":id";
    return segment;
  });

  return `/${cleaned.join("/")}`;
}
