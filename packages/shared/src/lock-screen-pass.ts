/**
 * The lock-screen / wallet pass payload (S09x-c, CMO item C8: approved text, not signed).
 *
 * A pass shows on a locked phone that may be shared with a household, so it carries the minimum a responder needs and nothing a stranger could
 * misuse: initials, blood group, genotype with how it is known, THAT allergies are on file (never which), the emergency contact's phone, and a hint
 * that the full record needs the patient's unlock. No medicine, condition or allergen name can ever reach it:
 *   1. the database function `my_lock_screen_facts` already returns no such name;
 *   2. this builder is a whitelist, so even a leaky caller (extra keys, a string where a flag belongs) cannot widen the payload;
 *   3. every value is validated against the shape it may take, so free text cannot ride in under an allowed key.
 *
 * Pure and dependency free: used by the web printable card, the dormant wallet generator and the phone.
 */

export const LOCK_SCREEN_FIELDS = [
  "initials",
  "blood_group",
  "genotype",
  "genotype_provenance",
  "allergies_on_file",
  "emergency_contact_phone",
  "unlock_hint",
] as const;
export type LockScreenField = (typeof LOCK_SCREEN_FIELDS)[number];

/** What `public.my_lock_screen_facts()` returns. Anything not named here is ignored. */
export interface LockScreenFacts {
  enabled?: boolean;
  fields_signed?: boolean;
  fields?: readonly string[];
  initials?: unknown;
  blood_group?: unknown;
  genotype?: unknown;
  genotype_provenance?: unknown;
  allergies_on_file?: unknown;
  emergency_contact_phone?: unknown;
}

export interface LockScreenRow {
  readonly key: LockScreenField;
  readonly label: string;
  readonly value: string;
}

export interface LockScreenPayload {
  readonly rows: readonly LockScreenRow[];
}

const BLOOD_GROUPS = new Set(["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"]);
const PROVENANCE_LABEL: Readonly<Record<string, string>> = {
  patient_attested: "Told to us by you",
  lab_document: "Confirmed by a lab report",
};

export const UNLOCK_HINT = "Full record needs your unlock";

export interface BuildOptions {
  /**
   * Device and wallet surfaces require the CMO to have signed the field list (C8). The patient's own printed card does not: they choose to print it.
   * Default true, so forgetting the option fails closed.
   */
  readonly requireSigned?: boolean;
}

/** Returns null when the pass is off, or (for a device or wallet surface) when the field list is not yet signed. */
export function buildLockScreenPayload(facts: LockScreenFacts | null | undefined, options: BuildOptions = {}): LockScreenPayload | null {
  if (!facts || facts.enabled !== true) return null;
  if ((options.requireSigned ?? true) && facts.fields_signed !== true) return null;

  const allowed = new Set<string>((facts.fields ?? LOCK_SCREEN_FIELDS).filter((f): f is string => typeof f === "string"));
  const rows: LockScreenRow[] = [];
  const add = (key: LockScreenField, label: string, value: string | null) => {
    if (value !== null && allowed.has(key)) rows.push({ key, label, value });
  };

  const initials = typeof facts.initials === "string" && /^[A-Z]{1,3}$/.test(facts.initials) ? facts.initials : null;
  add("initials", "Initials", initials);

  const blood = typeof facts.blood_group === "string" && BLOOD_GROUPS.has(facts.blood_group) ? facts.blood_group : null;
  add("blood_group", "Blood group", blood);

  const genotype = typeof facts.genotype === "string" && /^[A-Z]{2}$/.test(facts.genotype) ? facts.genotype : null;
  add("genotype", "Genotype", genotype);

  // The provenance badge only means something next to a genotype or blood group, so it is dropped on its own.
  const provenance =
    (genotype !== null || blood !== null) && typeof facts.genotype_provenance === "string" ? (PROVENANCE_LABEL[facts.genotype_provenance] ?? null) : null;
  add("genotype_provenance", "How we know", provenance);

  // Exactly the boolean true. A string (an allergen name from a leaky caller) is not a flag and is dropped.
  add("allergies_on_file", "Allergies", facts.allergies_on_file === true ? "Allergies on file" : null);

  const phone = typeof facts.emergency_contact_phone === "string" && /^\+[1-9][0-9]{7,14}$/.test(facts.emergency_contact_phone) ? facts.emergency_contact_phone : null;
  add("emergency_contact_phone", "Emergency contact", phone);

  add("unlock_hint", "Full record", UNLOCK_HINT);

  return rows.length > 0 ? { rows } : null;
}
