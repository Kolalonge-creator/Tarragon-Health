/**
 * The ICD-10 shape the database accepts on `clinical_encounter_notes.diagnosis_code`
 * (S59d). The same pattern is enforced by the column CHECK and by
 * `set_encounter_note_diagnosis_code`; this copy only lets the editor say so
 * before a round trip. It checks shape, not that the code exists.
 */
export const ICD10_SHAPE = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/;

export const ICD10_HINT = "An ICD-10 code looks like B50.9 or I10. Leave it empty if you do not want to code this note.";

export type Icd10Result = { ok: true; code: string | null } | { ok: false };

/** Trims and upper-cases; an empty value is valid and means "no code". */
export function normaliseIcd10(input: string): Icd10Result {
  const code = input.trim().toUpperCase();
  if (code === "") return { ok: true, code: null };
  return ICD10_SHAPE.test(code) ? { ok: true, code } : { ok: false };
}
