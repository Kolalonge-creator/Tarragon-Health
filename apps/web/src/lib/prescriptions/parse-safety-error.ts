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
  | { code: "unknown"; raw: string };

export type SafetyError =
  | { kind: "blocked" }
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
    return { code: "unknown", raw: typeof v.code === "string" ? v.code : "unrecognised" };
  }
  return { code: "unknown", raw: "unrecognised" };
}

/** Null when the error is not a signing safety stop at all (so the caller shows its own message). */
export function parseSafetyError(error: unknown): SafetyError | null {
  const { detail, hint } = readDetail(error);
  if (detail === "SAFETY_BLOCKED") return { kind: "blocked" };
  if (detail !== "SAFETY_FINDINGS") return null;
  let parsed: unknown = null;
  try {
    parsed = hint ? JSON.parse(hint) : null;
  } catch {
    parsed = null;
  }
  const items = Array.isArray(parsed) ? parsed : [];
  const findings = items.map(toFinding);
  if (findings.length === 0) findings.push({ code: "unknown", raw: "unreadable" });
  return { kind: "findings", findings };
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
