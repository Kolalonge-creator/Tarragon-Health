import { ADULT_ONLY_MESSAGE, INVALID_DOB_MESSAGE, checkAdultDateOfBirth } from "@tarragon/shared";

export type AdultGateResult =
  | { ok: true; dateOfBirth: string }
  | { ok: false; error: string; field: "dateOfBirth" };

/**
 * Registration is for adults (S04b-1). Reads the date of birth from the sign-up form and refuses anyone under 18, or a
 * date that is not real, before any account or code is created. The database repeats the rule
 * (private.handle_new_user and private.enforce_adult_registration), so this is the calm first answer, not the only one.
 * Kept in its own file so the sign-up actions only carry a two-line call.
 */
export function readAdultDob(formData: FormData, today: Date = new Date()): AdultGateResult {
  const raw = String(formData.get("dateOfBirth") ?? "").trim();
  const verdict = checkAdultDateOfBirth(raw, today);
  if (verdict === "adult") return { ok: true, dateOfBirth: raw };
  return {
    ok: false,
    field: "dateOfBirth",
    error: verdict === "under_age" ? ADULT_ONLY_MESSAGE : INVALID_DOB_MESSAGE,
  };
}
