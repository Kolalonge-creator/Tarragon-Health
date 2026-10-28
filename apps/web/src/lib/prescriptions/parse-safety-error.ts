/**
 * S24: the signing checks in the database (private.check_prescription_safety) stop a prescription or a care plan change with SQLSTATE
 * P0001 and one of two details:
 *   SAFETY_FINDINGS  the hint carries a JSON array of findings; the signer may go ahead by giving a reason (and, where the allergy list is
 *                    empty, by confirming the list was checked)
 *   SAFETY_BLOCKED   a controlled medicine; no override exists
 *
 * This turns that error into something the form can show. It never fails open: a findings error whose hint cannot be read is still a
 * findings error (with one "unknown" finding that needs a reason), never a plain failure that a retry could slip past.
 */

export type SafetyFinding =
  | { code: "allergy_match"; allergen: string }
  | { code: "allergies_unrecorded" }
  | { code: "duplicate_active" }
  | { code: "baseline_labs_missing"; missing: string[] }
  | { code: "metformin_egfr_below_30"; egfr: number | null }
  | { code: "metformin_egfr_review_dose"; egfr: number | null }
  | { code: "metformin_egfr_unknown" }
  | { code: "pregnancy_not_excluded" }
  | { code: "unknown"; raw: string };

export type SafetyError =
  | { kind: "blocked"; findings?: SafetyFinding[] }
  | { kind: "findings"; findings: SafetyFinding[] };

/** What a signer must supply before the same request is sent again. */
export type SafetyResubmit = { allergiesConfirmed: boolean; overrideReason: string };

export const CONTROLLED_MEDICINE_MESSAGE = "TarragonHealth does not prescribe controlled medicines.";

function readDetail(error: unknown): { detail: string | null; hint: string | null } {
  if (typeof error !== "object" || error === null) return { detail: null, hint: null };
  const e = error as Record<string, unknown>;
  // PostgrestError uses `details`; a serialised copy from a server action may use `detail`.
  const detail = typeof e.details === "string" ? e.details : typeof e.detail === "string" ? e.detail : null;
  const hint = typeof e.hint === "string" ? e.hint : null;
  return { detail, hint };
}

function toFinding(value: unknown): SafetyFinding {
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if (v.code === "allergy_match" && typeof v.allergen === "string" && v.allergen.trim() !== "") {
      return { code: "allergy_match", allergen: v.allergen.trim() };
    }
    if (v.code === "allergies_unrecorded") return { code: "allergies_unrecorded" };
    if (v.code === "duplicate_active") return { code: "duplicate_active" };
    if (v.code === "baseline_labs_missing") {
      const missing = Array.isArray(v.missing) ? v.missing.filter((m): m is string => typeof m === "string") : [];
      return { code: "baseline_labs_missing", missing };
    }
    if (v.code === "metformin_egfr_below_30") return { code: "metformin_egfr_below_30", egfr: typeof v.egfr === "number" ? v.egfr : null };
    if (v.code === "metformin_egfr_review_dose") return { code: "metformin_egfr_review_dose", egfr: typeof v.egfr === "number" ? v.egfr : null };
    if (v.code === "metformin_egfr_unknown") return { code: "metformin_egfr_unknown" };
    if (v.code === "pregnancy_not_excluded") return { code: "pregnancy_not_excluded" };
    return { code: "unknown", raw: typeof v.code === "string" ? v.code : "unrecognised" };
  }
  return { code: "unknown", raw: "unrecognised" };
}

/** Null when the error is not a signing safety stop at all (so the caller shows its own message). */
export function parseSafetyError(error: unknown): SafetyError | null {
  const { detail, hint } = readDetail(error);
  if (detail !== "SAFETY_BLOCKED" && detail !== "SAFETY_FINDINGS") return null;
  let parsed: unknown = null;
  try {
    parsed = hint ? JSON.parse(hint) : null;
  } catch {
    parsed = null;
  }
  const items = Array.isArray(parsed) ? parsed : [];
  if (detail === "SAFETY_BLOCKED") return { kind: "blocked", findings: items.map(toFinding) };
  const findings = items.map(toFinding);
  if (findings.length === 0) findings.push({ code: "unknown", raw: "unreadable" });
  return { kind: "findings", findings };
}

const ANALYTE_WORDS: Record<string, string> = {
  creatinine: "creatinine (kidney function)",
  potassium: "potassium",
  sodium: "sodium",
  hba1c: "HbA1c",
  fasting_glucose: "fasting glucose",
  fasting_glucose_or_hba1c: "fasting glucose or HbA1c",
};
function describeAnalyte(code: string): string {
  return ANALYTE_WORDS[code] ?? code;
}

/** One finding in plain words for the signer. */
export function describeFinding(finding: SafetyFinding): string {
  switch (finding.code) {
    case "allergy_match":
      return `This patient has a recorded allergy to ${finding.allergen}, and this medicine matches it.`;
    case "allergies_unrecorded":
      return "This patient's allergy list is empty, so the allergy check could not run.";
    case "duplicate_active":
      return "This patient is already taking this medicine.";
    case "baseline_labs_missing":
      return `The record has no recent result for: ${finding.missing.map(describeAnalyte).join(", ") || "the baseline tests"}. Order them first. You may start today only if waiting would do more harm, and then the tests are due within 7 days.`;
    case "metformin_egfr_below_30":
      return `This patient's kidney function (eGFR${finding.egfr === null ? "" : ` about ${finding.egfr}`}) is under 30, so metformin must not be started.`;
    case "metformin_egfr_review_dose":
      return `This patient's kidney function (eGFR${finding.egfr === null ? "" : ` about ${finding.egfr}`}) is under 45, so review the metformin dose.`;
    case "metformin_egfr_unknown":
      return "Kidney function could not be worked out from the record (a missing age, sex or unit), so check it before starting metformin.";
    case "pregnancy_not_excluded":
      return "This woman could be pregnant and there is no recent negative pregnancy test. Record that you have excluded pregnancy.";
    case "unknown":
      return "A safety check raised a finding that this screen cannot describe. Treat it as needing your attention.";
  }
}

/** The allergy confirmation is only relevant when the list is empty. */
export function needsAllergyConfirmation(error: SafetyError): boolean {
  return error.kind === "findings" && error.findings.some((f) => f.code === "allergies_unrecorded");
}

/**
 * A reason is needed for every finding except an empty allergy list, which the confirmation clears on its own (it mirrors
 * private.check_prescription_safety, which is still the real gate).
 */
export function needsOverrideReason(error: SafetyError): boolean {
  return error.kind === "findings" && error.findings.some((f) => f.code !== "allergies_unrecorded");
}

/** True when the signer has supplied what the findings ask for. A blocked error is never ready. */
export function isSafetyResubmitReady(error: SafetyError, input: SafetyResubmit): boolean {
  if (error.kind === "blocked") return false;
  if (needsAllergyConfirmation(error) && !input.allergiesConfirmed) return false;
  if (needsOverrideReason(error) && input.overrideReason.trim() === "") return false;
  return true;
}
