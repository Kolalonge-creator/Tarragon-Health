// S85 journey harness: the readable text of a payload.
//
// A "carries no clinical content" check is a regex over what a person could read. Run over the raw JSON it also reads the identifiers
// the payload carries, and a random UUID (or the microseconds of a timestamp) contains the digits of a reading about 1 run in 70 to
// 100: "1aa58bf5-f934-4b7a-ba57-0b1200893c3b" contains "120", so a check for "120" failed at random (PR 1558, 2026-10-30). Identifiers
// and timestamps are removed first, so the check reads only the words and numbers a person would. Same pattern as check E2 in
// packages/db/tests/fu_notify_rules_and_contact.sql. Pure on purpose: packages/shared/src/journeys/payload-text.test.ts runs it.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?/g;

/** The payload as JSON text with every uuid, email address and ISO timestamp removed. */
export function readableText(value: unknown): string {
  return (JSON.stringify(value) ?? "").replace(UUID, "").replace(EMAIL, "").replace(ISO_TIMESTAMP, "");
}

/**
 * What a notice to a supporter must never say (INV-07): a condition, a reading, a grade or a cause. A reading is matched as a whole
 * number, so 190 or 120 inside a longer digit run (a phone number, an epoch, a counter) is not a hit.
 */
export const CLINICAL_CONTENT = /blood|pressure|(?<!\d)(?:190|120)(?!\d)|red|headache|emergency/i;

/** True when `text` contains the number `reading` as a whole number (`190` matches `190/120` but not `1190`). */
export function containsNumber(text: string, reading: string): boolean {
  const escaped = reading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\d)${escaped}(?!\\d)`).test(text);
}

export function carriesClinicalContent(value: unknown): boolean {
  return CLINICAL_CONTENT.test(readableText(value));
}
