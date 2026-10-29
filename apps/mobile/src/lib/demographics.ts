import { checkAdultDateOfBirth } from "@tarragon/shared";

/**
 * Sex and date of birth are mandatory for a patient (founder/CMO instruction 2026-10-29). Screening rules, vaccination schedules and
 * every age-banded range read them, and a patient without them is silently never screened. The web asks during onboarding and the
 * database refuses to complete onboarding without them; the phone app has no onboarding flow, so a patient who signed up on the phone
 * was never asked for a sex. This is the phone's gate: shown before the app opens, only when something is missing.
 *
 * It only ever FILLS IN a missing value. A value already on file is never overwritten from here: changing sex or date of birth on file
 * goes through the care team (the profile screen says so).
 */
export type Sex = "male" | "female";

export const SEX_OPTIONS: ReadonlyArray<{ value: Sex; label: string }> = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

export interface DemographicsIdentity {
  role: string | null;
  sex: string | null;
  dateOfBirth: string | null;
  /** profiles.receives_care; false for somebody who is here only to fund another person's care. */
  receivesCare: boolean | null;
  isDependent: boolean | null;
}

/** True when a patient has to be asked before the app opens. Never for staff, a funder-only account or a dependant profile. */
export function needsDemographics(identity: DemographicsIdentity): boolean {
  if (identity.role !== "patient") return false;
  if (identity.receivesCare === false) return false;
  if (identity.isDependent === true) return false;
  return !identity.sex || !identity.dateOfBirth;
}

export type DemographicsReason = "sex_required" | "dob_invalid" | "dob_underage";

export type DemographicsPlan =
  | { ok: true; patch: { sex?: Sex; date_of_birth?: string }; onlyIfNull: Array<"sex" | "date_of_birth"> }
  | { ok: false; reason: DemographicsReason };

/** What to write for the fields that are missing, and which columns must still be empty when it is written. */
export function planDemographicsUpdate(
  identity: Pick<DemographicsIdentity, "sex" | "dateOfBirth">,
  input: { sex: string | null; dateOfBirth: string },
): DemographicsPlan {
  const patch: { sex?: Sex; date_of_birth?: string } = {};
  const onlyIfNull: Array<"sex" | "date_of_birth"> = [];

  if (!identity.sex) {
    if (input.sex !== "male" && input.sex !== "female") return { ok: false, reason: "sex_required" };
    patch.sex = input.sex;
    onlyIfNull.push("sex");
  }
  if (!identity.dateOfBirth) {
    const dob = input.dateOfBirth.trim();
    const verdict = checkAdultDateOfBirth(dob);
    if (verdict === "under_age") return { ok: false, reason: "dob_underage" };
    if (verdict !== "adult") return { ok: false, reason: "dob_invalid" };
    patch.date_of_birth = dob;
    onlyIfNull.push("date_of_birth");
  }
  return { ok: true, patch, onlyIfNull };
}
