/**
 * S05b record integrity vocabulary: one place for the three small rules.
 * The database is the authority; these helpers only name and label what it stores.
 * See docs/design/S05b.md.
 */

// 1. Genotype and blood group verification --------------------------------

export const BLOOD_VERIFICATIONS = ["self_reported", "lab_verified"] as const;
export type BloodVerification = (typeof BLOOD_VERIFICATIONS)[number];

/** `patient_blood_profile.provenance` is the stored fact; `verification` is derived from it in the database. */
export function bloodVerificationFromProvenance(provenance: string | null | undefined): BloodVerification {
  return provenance === "lab_document" ? "lab_verified" : "self_reported";
}

export const BLOOD_VERIFICATION_LABEL: Record<BloodVerification, string> = {
  self_reported: "Self-reported",
  lab_verified: "Verified by a lab",
};

// 2. Corrections: supersede, never edit -------------------------------------

export const CORRECTION_STATUSES = ["corrected", "amended", "entered_in_error", "cancelled"] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CORRECTION_STATUS_LABEL: Record<CorrectionStatus, string> = {
  corrected: "Corrected",
  amended: "Amended",
  entered_in_error: "Entered in error",
  cancelled: "Cancelled",
};

/** Tables on which the single correction function is the only way to change a recorded value. */
export const SUPERSEDING_TABLES = [
  "vitals_readings",
  "patient_conditions",
  "patient_allergies",
  "lab_analyte_readings",
] as const;
export type SupersedingTable = (typeof SUPERSEDING_TABLES)[number];

// 3. Range source on lab values ----------------------------------------------

export const RANGE_SOURCES = ["lab_report", "guideline", "cmo_signed_config", "unspecified"] as const;
export type RangeSource = (typeof RANGE_SOURCES)[number];

export function isRangeSource(value: unknown): value is RangeSource {
  return typeof value === "string" && (RANGE_SOURCES as readonly string[]).includes(value);
}

/**
 * The words shown next to a reference or target range. Never returns an empty string:
 * a range with no known source says so. `ref` is the guideline name or the signed config
 * identifier (for example "lab panel version 3").
 */
export function rangeSourceLabel(source: string | null | undefined, ref?: string | null): string {
  const named = ref?.trim() ? ref.trim() : null;
  switch (source) {
    case "lab_report":
      return "Range from the lab report";
    case "guideline":
      return named ? `Range from ${named}` : "Range from a clinical guideline (name not recorded)";
    case "cmo_signed_config":
      return named
        ? `Range from ${named}, signed by the Chief Medical Officer`
        : "Range from a signed Tarragon configuration";
    default:
      return "Range not specified";
  }
}

/** A range may be displayed as clinical only when its source is known. */
export function rangeMayBeShownAsClinical(source: string | null | undefined): boolean {
  return isRangeSource(source) && source !== "unspecified";
}
