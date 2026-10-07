import type { Enums } from "./database.types";

/** specialist_referrals.specialist_type / specialist_providers.specialist_type / clinical_staff.specialist_type. */
export type SpecialistType = Enums<"specialist_type">;

/**
 * Every `specialist_type` enum value, labeled for a picker. Single source of
 * truth for apps/web and apps/mobile -- before this existed, at least six
 * call sites (the referral form, the patient/mobile "find a specialist"
 * browsers, the clinical-staff credentialing admin UI, the specialist-
 * provider partner admin UI, and the consultation follow-up panel) each
 * hand-copied their own subset of the enum, and every one of them drifted
 * out of sync with a later `ALTER TYPE ... ADD VALUE` (psychiatry/psychology
 * added, then genitourinary_medicine added 2026-08-29) in a different way.
 * The clinical-staff credentialing UI drifting is the highest-stakes case:
 * a doctor can't be credentialed in a specialty that isn't offered here, so
 * a referral of that type can never auto-match to an in-house specialist
 * (private.auto_match_internal_specialist) no matter how many exist.
 *
 * Add a new value here (and to `packages/shared/src/database.types.ts`'s
 * `specialist_type` enum, which this list does not generate from -- there is
 * no live codegen wired into a build step) the same day it's added to the DB
 * enum, not as a follow-up.
 */
export const SPECIALIST_TYPE_OPTIONS: { value: SpecialistType; label: string }[] = [
  { value: "cardiology", label: "Cardiology" },
  { value: "endocrinology", label: "Endocrinology" },
  { value: "nephrology", label: "Nephrology" },
  { value: "ophthalmology", label: "Ophthalmology" },
  { value: "ob_gyn", label: "Obstetrics & Gynaecology (O&G)" },
  { value: "urologist", label: "Urology" },
  { value: "oncologist", label: "Oncology" },
  { value: "dietetics", label: "Dietetics" },
  { value: "podiatry", label: "Podiatry" },
  { value: "psychiatry", label: "Psychiatry" },
  { value: "psychology", label: "Psychology" },
  { value: "genitourinary_medicine", label: "Genitourinary Medicine (Sexual Health)" },
  { value: "other", label: "Other" },
];

/** Just the values, in the same order, for a call site that doesn't need labels. */
export const SPECIALIST_TYPES: SpecialistType[] = SPECIALIST_TYPE_OPTIONS.map((o) => o.value);

/**
 * Same values as SPECIALIST_TYPES, as a literal tuple -- what a zod-enum
 * call site needs. `z.enum` requires a `readonly [T, ...T[]]` tuple type to
 * infer a literal union, and SPECIALIST_TYPES' widened `SpecialistType[]`
 * type doesn't satisfy that -- see apps/web/src/lib/ai-coach/referral-tool.ts
 * for a real consumer. The cast is safe: SPECIALIST_TYPE_OPTIONS is never
 * empty, and specialist-type-options.test.ts asserts this still covers
 * every live enum value.
 */
export const SPECIALIST_TYPE_VALUES = SPECIALIST_TYPE_OPTIONS.map((o) => o.value) as [
  SpecialistType,
  ...SpecialistType[],
];

/** Value -> label lookup, for a call site that renders a badge/table cell rather than a picker. */
export const SPECIALIST_TYPE_LABEL: Record<SpecialistType, string> = SPECIALIST_TYPE_OPTIONS.reduce(
  (acc, o) => {
    acc[o.value] = o.label;
    return acc;
  },
  {} as Record<SpecialistType, string>
);

/**
 * The practitioner noun for a specialist_type -- the person who practices
 * the specialty, for prose that addresses a person ("any cardiologist the
 * patient chooses", not "any cardiology"), e.g. a referral letter's
 * salutation. A different shape from SPECIALIST_TYPE_LABEL, which labels the
 * specialty itself (genitourinary_medicine -> "Genitourinary Medicine
 * (Sexual Health)" there, vs. "genitourinary medicine specialist" here).
 * `Record<SpecialistType, string>`, not `Record<string, string>`, so a
 * missing entry for a new enum value fails `tsc`, not just a test.
 */
export const SPECIALIST_TYPE_NOUN: Record<SpecialistType, string> = {
  urologist: "urologist",
  oncologist: "oncologist",
  ob_gyn: "OB-GYN",
  cardiology: "cardiologist",
  endocrinology: "endocrinologist",
  nephrology: "nephrologist",
  ophthalmology: "ophthalmologist",
  dietetics: "dietitian",
  podiatry: "podiatrist",
  psychiatry: "psychiatrist",
  psychology: "psychologist",
  genitourinary_medicine: "genitourinary medicine specialist",
  other: "specialist",
};

/**
 * The practitioner noun for a `specialist_type` value that isn't
 * necessarily known to be one at the type level (e.g. a DB column typed
 * `string`). Falls back to a humanised version of the raw value for
 * anything not in `SPECIALIST_TYPE_NOUN`, so an unrecognised value degrades
 * to readable text rather than throwing or printing a raw underscored code.
 */
export function specialistTypeNoun(value: string): string {
  return SPECIALIST_TYPE_NOUN[value as SpecialistType] ?? value.replace(/_/g, " ");
}
