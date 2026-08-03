/**
 * The exact wording a patient agrees to when they record their own blood group
 * or genotype, versioned so it is always traceable which text they saw.
 *
 * ⚠️ THIS IS NOT A LIABILITY CLAUSE, deliberately. The founder asked for
 * patients to attest and be "liable for any error". What is encoded here is an
 * ATTESTATION — a recorded statement of what the patient confirmed and when.
 * What someone is legally answerable for is for counsel to word, and it belongs
 * with the rest of the consent copy already pending legal review, not invented
 * in application code.
 *
 * To add such wording once counsel supplies it: add the sentence below AND bump
 * `BLOOD_ATTESTATION_VERSION`. Never edit the text without bumping the version,
 * or a patient's stored attestation will point at wording they never saw.
 */
export const BLOOD_ATTESTATION_VERSION = "blood-attestation-2026-08-03";

export const BLOOD_ATTESTATION_TEXT = [
  "I confirm this is what my own test result showed, not what I think or was told informally.",
  "I understand it will be shown to anyone I share my emergency card with, including hospital staff who have no other way to check it.",
  "I understand that a wrong value here could lead to the wrong treatment, and that I should upload the lab report so my care team can confirm it.",
] as const;

/** Shown wherever a patient-attested value is displayed to a clinician or a stranger. */
export const PATIENT_ATTESTED_CAVEAT =
  "Self-reported by the patient, not confirmed against a lab report.";
