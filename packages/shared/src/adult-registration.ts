/**
 * Registration is for adults (18 and over) only, founder decision 2026-10-13 (S04b-1). The database enforces the same
 * rule (private.enforce_adult_registration on profiles and private.handle_new_user); this is the shared check the web
 * and mobile sign-up use to give a calm answer before anything is sent.
 */
export const MIN_REGISTRATION_AGE = 18;

export type AdultDobVerdict = "adult" | "under_age" | "invalid";

/** Parses a strict YYYY-MM-DD date; null when it is not a real calendar date. */
export function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * "adult" when the person is at least 18 on `today` (their 18th birthday counts), "under_age" when younger or the date
 * is in the future, "invalid" when it is not a real date. A date before 1900 is treated as invalid (a typing slip).
 */
export function checkAdultDateOfBirth(value: string, today: Date = new Date()): AdultDobVerdict {
  const dob = parseIsoDate(value);
  if (!dob || dob.y < 1900) return "invalid";
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth() + 1;
  const td = today.getUTCDate();
  // Compare (y+18, m, d) with today without any time-zone arithmetic.
  const eighteenth = dob.y + MIN_REGISTRATION_AGE;
  const reached = ty > eighteenth || (ty === eighteenth && (tm > dob.m || (tm === dob.m && td >= dob.d)));
  return reached ? "adult" : "under_age";
}

/** Calm wording for a refusal. Never blames, never names a rule number. */
export const ADULT_ONLY_MESSAGE =
  "Tarragon accounts are for adults aged 18 and over. If you look after a child, you can add them to your own account once you have signed up.";
export const INVALID_DOB_MESSAGE = "Enter your date of birth as day, month and year.";
