/**
 * S24: the signing checks in the database (private.check_prescription_safety) stop a prescription or a care plan change with SQLSTATE
 * P0001 and one of two details:
 *   SAFETY_FINDINGS  the hint carries a JSON array of findings; the signer may go ahead by giving a reason (and, where the allergy list is
 *                    empty, by confirming the list was checked)
 *   SAFETY_BLOCKED   a controlled medicine, or (T2-11b) a contraindicated pair in the signed interaction rules; no override exists
 * and, since T2-11b, SAFETY_CHECK_UNAVAILABLE when no signed interaction dataset and rule set are active (nothing can be signed).
 *
 * This turns that error into something the form can show. It never fails open: a findings error whose hint cannot be read is still a
 * findings error (with one "unknown" finding that needs a reason), never a plain failure that a retry could slip past.
 */

export type SafetyFinding =
  | { code: "allergy_match"; allergen: string }
  | { code: "allergies_unrecorded" }
  | { code: "duplicate_active" }
  /** T2-11b: the allergen is in the same drug class as the new medicine (penicillin allergy, amoxicillin). */
  | { code: "allergy_class_match"; allergen: string; drugClass: string | null }
  /** T2-11b: a caution pair in the signed interaction dataset or rule set (info pairs never stop signing, so never arrive here). */
  | { code: "interaction"; withDrug: string; severity: string; title: string | null }
  | { code: "unknown"; raw: string };

/** A contraindicated pair that stopped the signing outright (T2-11b). */
export interface BlockedInteraction {
  withDrug: string;
  title: string | null;
}

export type SafetyError =
  /** `interactions` is present only when a contraindicated pair (not a controlled medicine) stopped the signing. */
  | { kind: "blocked"; interactions?: BlockedInteraction[] }
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
    if (v.code === "allergy_class_match" && typeof v.allergen === "string" && v.allergen.trim() !== "") {
      return { code: "allergy_class_match", allergen: v.allergen.trim(), drugClass: typeof v.drug_class === "string" ? v.drug_class : null };
    }
    if (v.code === "interaction" && typeof v.with === "string" && v.with.trim() !== "") {
      return {
        code: "interaction",
        withDrug: v.with.trim(),
        severity: typeof v.severity === "string" ? v.severity : "caution",
        title: typeof v.title === "string" && v.title.trim() !== "" ? v.title.trim() : null,
      };
    }
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
  if (detail === "SAFETY_BLOCKED") {
    const isControlled = items.some((i) => typeof i === "object" && i !== null && (i as Record<string, unknown>).code === "controlled_medicine");
    const interactions: BlockedInteraction[] = [];
    for (const i of items) {
      if (typeof i !== "object" || i === null) continue;
      const v = i as Record<string, unknown>;
      if (v.code === "interaction" && v.blocking === true && typeof v.with === "string") {
        const title = typeof v.title === "string" && v.title.trim() !== "" ? v.title.trim() : null;
        if (!interactions.some((x) => x.withDrug === v.with && x.title === title)) interactions.push({ withDrug: v.with, title });
      }
    }
    // A controlled medicine wins: that stop has its own fixed wording. An unreadable hint is treated as the controlled stop (never as a pass).
    return isControlled || interactions.length === 0 ? { kind: "blocked" } : { kind: "blocked", interactions };
  }
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
    case "allergy_class_match":
      return `This patient has a recorded allergy to ${finding.allergen}, and this medicine is in the same group${finding.drugClass ? ` (${finding.drugClass.replace(/_/g, " ")})` : ""}.`;
    case "interaction":
      return `This medicine interacts with ${finding.withDrug}, which the patient already takes${finding.title ? `: ${finding.title}` : ""}. The signed interaction rules ask for caution.`;
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

/**
 * T2-11: signing is closed while the prescribing master (`prescribing_enabled`) is off; the database refuses with
 * `prescribing_guard_off` (SQLSTATE 55000). The form shows this sentence instead of a generic "try again", because retrying cannot help.
 */
export const PRESCRIBING_SWITCHED_OFF_MESSAGE =
  "Prescribing is not switched on yet, so this prescription was not signed. The Chief Medical Officer switches it on from the go-live page.";

export function isPrescribingSwitchedOff(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.includes("prescribing_guard_off");
}

/**
 * T2-11b: plain sentences for the other two ways signing is refused before any finding is shown. Returns null for anything else, so the
 * caller keeps its own message. Both are facts a retry cannot change.
 */
export const INTERACTION_CHECK_UNAVAILABLE_MESSAGE =
  "The interaction check cannot run because no signed interaction rules are active, so nothing can be signed. Ask the Chief Medical Officer to check the signed sets.";
export const PRESCRIBER_LICENCE_MESSAGE =
  "Your registration is not shown as verified and current, or your registration number is missing, so you cannot sign prescriptions. Ask an admin to update your record.";

export function describePrescribingRefusal(error: unknown): string | null {
  if (isPrescribingSwitchedOff(error)) return PRESCRIBING_SWITCHED_OFF_MESSAGE;
  const { detail } = readDetail(error);
  if (detail === "SAFETY_CHECK_UNAVAILABLE") return INTERACTION_CHECK_UNAVAILABLE_MESSAGE;
  const message = typeof error === "object" && error !== null ? (error as Record<string, unknown>).message : null;
  if (typeof message === "string" && message.includes("prescriber_licence_not_verified")) return PRESCRIBER_LICENCE_MESSAGE;
  return null;
}
