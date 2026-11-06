/**
 * Reads what a clinician typed into a patient search box (doctor workspace spec 6, 25; founder decision DW-01) and
 * says which identifier it is: a Tarragon number (TH-…), a phone number, or a name. Pure; the caller builds the query.
 *
 * Phone numbers are matched in E.164 (+234…), the only form stored (CLAUDE.md), so a local "0803 123 4567" is
 * converted. A partial number of 7 or more digits is matched as a fragment.
 */
export type PatientSearchQuery =
  | { kind: "empty" }
  | { kind: "number"; digits: string }
  | { kind: "phone"; e164: string }
  | { kind: "phone_fragment"; digits: string }
  | { kind: "name"; text: string };

const MAX_LEN = 100;

export function parsePatientSearchQuery(raw: string | null | undefined): PatientSearchQuery {
  const text = (raw ?? "").trim().slice(0, MAX_LEN);
  if (!text) return { kind: "empty" };

  const number = /^th[-\s]?0*(\d+)$/i.exec(text);
  if (number?.[1]) return { kind: "number", digits: number[1] };

  if (/^[+\d][\d\s\-()]*$/.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (/^0\d{10}$/.test(digits)) return { kind: "phone", e164: `+234${digits.slice(1)}` };
    if (/^234\d{10}$/.test(digits)) return { kind: "phone", e164: `+${digits}` };
    if (/^\d{10}$/.test(digits) && !digits.startsWith("0")) return { kind: "phone", e164: `+234${digits}` };
    if (digits.length >= 7) return { kind: "phone_fragment", digits };
    // A short run of digits is most likely the number part of a Tarragon number typed without "TH-".
    if (digits.length > 0) return { kind: "number", digits: digits.replace(/^0+/, "") || "0" };
  }

  return { kind: "name", text };
}

/** Escapes the LIKE wildcards so a typed "%" or "_" is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Human description of the search, for the results heading ("Phone: +2348031234567"). */
export function describePatientSearch(q: PatientSearchQuery): string | null {
  switch (q.kind) {
    case "empty":
      return null;
    case "number":
      return `Tarragon number containing ${q.digits}`;
    case "phone":
      return `Phone: ${q.e164}`;
    case "phone_fragment":
      return `Phone containing ${q.digits}`;
    case "name":
      return `Name: “${q.text}”`;
  }
}
