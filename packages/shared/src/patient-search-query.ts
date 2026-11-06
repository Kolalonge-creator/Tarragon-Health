/**
 * Reads what a clinician typed into a patient search box (doctor workspace spec 6, 25; founder decision DW-01) and
 * says which identifier it is: a Tarragon number (TH-…), a phone number, or a name. Pure; the caller builds the query.
 *
 * Phone numbers are matched in E.164 (+234…), the only form stored (CLAUDE.md), so a local "0803 123 4567" is
 * converted. A partial number of 7 or more digits is matched as a fragment.
 */
export type PatientSearchQuery =
  | { kind: "empty" }
  | { kind: "number"; digits: string; exact: string }
  | { kind: "phone"; e164: string }
  | { kind: "phone_fragment"; digits: string }
  | { kind: "name"; text: string };

const MAX_LEN = 100;

export function parsePatientSearchQuery(raw: string | null | undefined): PatientSearchQuery {
  const text = (raw ?? "").trim().slice(0, MAX_LEN);
  if (!text) return { kind: "empty" };

  const number = /^th[-\s]?(\d+)$/i.exec(text);
  if (number?.[1]) return numberQuery(number[1]);

  if (/^[+\d][\d\s\-()]*$/.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (/^0\d{10}$/.test(digits)) return { kind: "phone", e164: `+234${digits.slice(1)}` };
    if (/^234\d{10}$/.test(digits)) return { kind: "phone", e164: `+${digits}` };
    if (/^\d{10}$/.test(digits) && !digits.startsWith("0")) return { kind: "phone", e164: `+234${digits}` };
    // Stored numbers are E.164 (+234…), so a local trunk "0" is dropped from a fragment before matching.
    if (digits.length >= 7) return { kind: "phone_fragment", digits: digits.startsWith("0") ? digits.slice(1) : digits };
    // A short run starting 07, 08 or 09 is the start of a local mobile number ("0803"), not a Tarragon number.
    if (digits.length >= 4 && /^0[789]/.test(digits)) return { kind: "phone_fragment", digits: digits.slice(1) };
    // Otherwise a short run of digits is the number part of a Tarragon number typed without "TH-".
    if (digits.length > 0) return numberQuery(digits);
  }

  return { kind: "name", text };
}

/**
 * Tarragon numbers are "TH-" plus at least 6 digits, zero-padded (private.next_reference: lpad(n, 6, '0')), so a
 * typed number is matched exactly, never by suffix: a suffix match under a result cap could leave the exact patient out.
 */
function numberQuery(raw: string): PatientSearchQuery {
  const digits = raw.replace(/^0+/, "") || "0";
  return { kind: "number", digits, exact: `TH-${digits.padStart(6, "0")}` };
}

/** Escapes the LIKE wildcards so a typed "%" or "_" is matched literally. */
export function escapeLike(value: string): string {
  // PostgREST also reads "*" as a wildcard in like patterns.
  return value.replace(/[\\%_*]/g, (c) => `\\${c}`);
}

/** The forms a full number may be stored in: E.164 (the rule), plus "234…" and "0…" from before it was enforced. */
export function phoneStoredForms(e164: string): string[] {
  const national = e164.replace(/^\+234/, "");
  return [e164, `234${national}`, `0${national}`];
}

/** Human description of the search, for the results heading ("Phone: +2348031234567"). */
export function describePatientSearch(q: PatientSearchQuery): string | null {
  switch (q.kind) {
    case "empty":
      return null;
    case "number":
      return `Tarragon number ${q.exact}`;
    case "phone":
      return `Phone: ${q.e164}`;
    case "phone_fragment":
      return `Phone containing ${q.digits}`;
    case "name":
      return `Name: “${q.text}”`;
  }
}
