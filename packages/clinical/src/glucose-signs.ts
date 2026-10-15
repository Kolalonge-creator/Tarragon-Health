import type { GlucoseSymptomCode } from "./glucose-engine";

/**
 * The symptom_type the server's symptom log stores each glucose warning sign as. One table, read by the phone (which stores a ticked sign
 * through the offline outbox), by the migration that maps the stored rows back onto the engine's codes (a Jest test reads that migration and
 * fails if the two drift), and by the tests. The engine's code is the key, the symptom_type the value; the mapping back is the migration's
 * `triage_context_for_glucose_observation`.
 */
export const GLUCOSE_SIGN_SYMPTOM_TYPE = {
  confusion: "confusion",
  seizure: "convulsion",
  unconscious: "loss_of_consciousness",
  cannot_swallow: "cannot_swallow",
  vomiting: "vomiting",
  abdominal_pain: "abdominal_pain",
  fast_breathing: "breathlessness",
  drowsiness: "lethargy",
  very_thirsty_cannot_keep_fluids: "dehydration_signs",
} as const satisfies Record<GlucoseSymptomCode, string>;

export type GlucoseSignSymptomType = (typeof GLUCOSE_SIGN_SYMPTOM_TYPE)[GlucoseSymptomCode];

/** Written on every ticked sign so the stored severity is never mistaken for a patient rating. */
export const TICKED_ON_GLUCOSE_FORM_NOTE = "Ticked on the glucose form (not rated by the patient).";
