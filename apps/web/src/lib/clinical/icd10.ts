/**
 * The ICD-10 shape the database accepts on `clinical_encounter_notes.diagnosis_code`
 * (S59d). The same pattern is enforced by the column CHECK and by
 * `set_encounter_note_diagnosis_code`; this copy only lets the editor say so
 * before a round trip. It checks shape, not that the code exists.
 */
// Chapter U (for example U07.1) is excluded on purpose: it mirrors the database CHECK, which only admits [A-TV-Z] as the first character.
export const ICD10_SHAPE = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$/;

export const ICD10_HINT = "An ICD-10 code looks like B50.9 or I10. Leave it empty if you do not want to code this note.";

export type Icd10Result = { ok: true; code: string | null } | { ok: false };

/** Trims and upper-cases; an empty value is valid and means "no code". */
export function normaliseIcd10(input: string): Icd10Result {
  const code = input.trim().toUpperCase();
  if (code === "") return { ok: true, code: null };
  return ICD10_SHAPE.test(code) ? { ok: true, code } : { ok: false };
}

export type SaveCodeOutcome = { ok: true; saved: boolean } | { ok: false; reason: "malformed" | "refused"; message?: string };

/**
 * Saves the code only when it differs from the stored one. A malformed code is never sent; a refused save comes back as
 * `refused` so the caller can stop before signing (a signed note refuses the code, so it has to be on the draft first).
 */
export async function saveCodeIfChanged(
  input: string,
  stored: string | null,
  save: (code: string | null) => Promise<void>,
): Promise<SaveCodeOutcome> {
  const parsed = normaliseIcd10(input);
  if (!parsed.ok) return { ok: false, reason: "malformed" };
  if (parsed.code === stored) return { ok: true, saved: false };
  try {
    await save(parsed.code);
    return { ok: true, saved: true };
  } catch (err) {
    return { ok: false, reason: "refused", message: err instanceof Error ? err.message : undefined };
  }
}
