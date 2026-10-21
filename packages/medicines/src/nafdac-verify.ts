import { normaliseNafdacNumber } from "./nafdac-number";

/**
 * Storing the NAFDAC number a person copies from their pack, and where they can check it (S08y, item 4).
 *
 * STORE ONLY. Saving a number is a note for the person and their care team. Nothing here calls NAFDAC, nothing here says a
 * pack is genuine, fake, safe or approved, and Tarragon never sends an SMS to check it (INV-08): the person uses NAFDAC's own
 * channels, which the how-to card lists. Sources and the date they were read are in docs/research/S08y.md.
 */
export const NAFDAC_GREENBOOK_URL = "https://greenbook.nafdac.gov.ng";

/** NAFDAC's enquiries line as printed on nafdac.gov.ng (0700-1-NAFDAC). */
export const NAFDAC_ENQUIRY_LINE = "0700-1-623322";

/** The how-to steps, in order, as i18n keys. The card renders them as given and adds nothing about a pack's authenticity. */
export const NAFDAC_VERIFY_STEP_KEYS = [
  "medicines.nafdac.verify.step_greenbook",
  "medicines.nafdac.verify.step_scratch",
  "medicines.nafdac.verify.step_helpline",
] as const;

export type NafdacStoreResult =
  | { ok: true; /** The canonical number to save, or null to clear a saved one. */ value: string | null }
  | { ok: false; reason: "not_a_nafdac_number" };

/**
 * The value to store for what a person typed. Blank clears it. Anything that is not shaped like a NAFDAC number is refused here
 * (the database refuses it too), so a note cannot hold free text. A look-alike letter fixed on the way is flagged by
 * `normaliseNafdacNumber` and is refused rather than stored guessed.
 */
export function nafdacNumberToStore(typed: string): NafdacStoreResult {
  if (typed.trim().length === 0) return { ok: true, value: null };
  const n = normaliseNafdacNumber(typed);
  // A look-alike letter that had to be swapped (O for 0, I or L for 1) would store a number that may not be the one on the pack:
  // such a value is not stored and the person is told, so they can retype it.
  return n && !n.ocrCorrected ? { ok: true, value: n.value } : { ok: false, reason: "not_a_nafdac_number" };
}
