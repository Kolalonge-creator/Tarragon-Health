/**
 * Health history a person enters about themselves (S43, spec 2.2): the pure half, shared by the web form and the phone screen so the two
 * cannot drift. The database fixes source (patient), recorded_by and verification on insert, so nothing here can claim a clinician stood behind
 * an entry: this only keeps the text sane before it is sent.
 */
export const FAMILY_RELATIONSHIPS = [
  "mother",
  "father",
  "sibling",
  "child",
  "maternal_grandmother",
  "maternal_grandfather",
  "paternal_grandmother",
  "paternal_grandfather",
  "aunt_or_uncle",
  "other",
] as const;
export type FamilyRelationship = (typeof FAMILY_RELATIONSHIPS)[number];

export type HistoryValidationError =
  | "name_required"
  | "name_too_long"
  | "year_invalid"
  | "year_future"
  | "facility_too_long"
  | "condition_required"
  | "condition_too_long"
  | "relationship_invalid"
  | "onset_invalid";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: HistoryValidationError };

export interface ProcedureDraft {
  name: string;
  year: number | null;
  facility: string | null;
}

export interface FamilyDraft {
  condition: string;
  relationship: FamilyRelationship;
  onsetAge: number | null;
}

function wholeNumber(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return Number.NaN;
  return Number(s);
}

export function validateProcedure(input: { name: string; year?: string; facility?: string }, now: Date = new Date()): Validated<ProcedureDraft> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name_required" };
  if (name.length > 200) return { ok: false, error: "name_too_long" };
  const year = wholeNumber(input.year ?? "");
  if (year !== null && (Number.isNaN(year) || year < 1900)) return { ok: false, error: "year_invalid" };
  if (year !== null && year > now.getFullYear()) return { ok: false, error: "year_future" };
  const facility = (input.facility ?? "").trim();
  if (facility.length > 200) return { ok: false, error: "facility_too_long" };
  return { ok: true, value: { name, year, facility: facility || null } };
}

export function validateFamilyHistory(input: { condition: string; relationship: string; onsetAge?: string }): Validated<FamilyDraft> {
  const condition = input.condition.trim();
  if (!condition) return { ok: false, error: "condition_required" };
  if (condition.length > 120) return { ok: false, error: "condition_too_long" };
  if (!(FAMILY_RELATIONSHIPS as readonly string[]).includes(input.relationship)) return { ok: false, error: "relationship_invalid" };
  const onset = wholeNumber(input.onsetAge ?? "");
  if (onset !== null && (Number.isNaN(onset) || onset > 120)) return { ok: false, error: "onset_invalid" };
  return { ok: true, value: { condition, relationship: input.relationship as FamilyRelationship, onsetAge: onset } };
}
