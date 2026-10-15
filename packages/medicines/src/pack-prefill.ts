/**
 * Turning a pack-photo reading into a PREFILL of the add form (spec 8.1, S53).
 *
 * The reading is what a model transcribed from a photo. It is never a medicine on the patient's list: nothing is saved from
 * it until the patient has seen every field and ticked "these match my pack". This module holds that rule as a pure function
 * so web and mobile apply it the same way, and so a test can prove that an unconfirmed prefill is never submittable.
 */

export interface PackReadingLike {
  drug_name: string | null;
  brand_name: string | null;
  strength: string | null;
  form: string | null;
  nafdac_number: string | null;
  confidence: "low" | "medium" | "high";
  unreadable_reason: string | null;
}

export interface AddFormPrefill {
  drugName: string;
  dose: string;
  form: string;
  brandName: string;
  nafdacNumber: string;
  /** True when the model was not sure; the form should say so and keep the confirmation box unticked. */
  lowConfidence: boolean;
}

/** Null when the photo could not be read at all. Empty strings (never null) for fields the pack did not show. */
export function prefillFromPackReading(reading: PackReadingLike): AddFormPrefill | null {
  if (reading.unreadable_reason) return null;
  if (!reading.drug_name && !reading.brand_name) return null;
  return {
    drugName: ((reading.drug_name || reading.brand_name) as string).trim(),
    dose: (reading.strength ?? "").trim(),
    form: (reading.form ?? "").trim(),
    brandName: (reading.brand_name ?? "").trim(),
    nafdacNumber: (reading.nafdac_number ?? "").trim(),
    lowConfidence: reading.confidence === "low",
  };
}

/**
 * May the form be submitted? A prefilled form needs the patient's explicit confirmation of what is on screen. A form typed by
 * hand (or picked from the catalogue) needs none beyond the normal required fields.
 */
export function canSubmitAddForm(state: { hasName: boolean; prefilledFromPhoto: boolean; confirmedAgainstPack: boolean }): boolean {
  if (!state.hasName) return false;
  if (state.prefilledFromPhoto && !state.confirmedAgainstPack) return false;
  return true;
}
