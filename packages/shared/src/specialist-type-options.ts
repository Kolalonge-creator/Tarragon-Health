import type { Enums } from "./database.types";

/** specialist_referrals.specialist_type / specialist_providers.specialist_type / clinical_staff.specialist_type. */
export type SpecialistType = Enums<"specialist_type">;

/**
 * Every `specialist_type` enum value, as a literal `as const` tuple -- the
 * single source every other export in this file derives from, so they can
 * never drift from each other. A literal tuple (not just `SpecialistType[]`)
 * is what a zod-enum call site needs: `z.enum` requires a `readonly
 * [T, ...T[]]` tuple type to infer a literal union, and a plain widened
 * array (e.g. `SPECIALIST_TYPE_OPTIONS.map(o => o.value)`) doesn't satisfy
 * that -- see apps/web/src/lib/ai-coach/referral-tool.ts for a real zod
 * consumer of this export.
 *
 * Add a new value here (and to `packages/shared/src/database.types.ts`'s
 * `specialist_type` enum, which this list does not generate from -- there is
 * no live codegen wired into a build step) the same day it's added to the DB
 * enum, not as a follow-up.
 */
export const SPECIALIST_TYPE_VALUES = [
  "cardiology",
  "endocrinology",
  "nephrology",
  "ophthalmology",
  "ob_gyn",
  "urologist",
  "oncologist",
  "dietetics",
  "podiatry",
  "psychiatry",
  "psychology",
  "genitourinary_medicine",
  "other",
] as const satisfies readonly SpecialistType[];

const SPECIALIST_TYPE_LABELS: Record<SpecialistType, string> = {
  cardiology: "Cardiology",
  endocrinology: "Endocrinology",
  nephrology: "Nephrology",
  ophthalmology: "Ophthalmology",
  ob_gyn: "Obstetrics & Gynaecology (O&G)",
  urologist: "Urology",
  oncologist: "Oncology",
  dietetics: "Dietetics",
  podiatry: "Podiatry",
  psychiatry: "Psychiatry",
  psychology: "Psychology",
  genitourinary_medicine: "Genitourinary Medicine (Sexual Health)",
  other: "Other",
};

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
 */
export const SPECIALIST_TYPE_OPTIONS: { value: SpecialistType; label: string }[] = SPECIALIST_TYPE_VALUES.map(
  (value) => ({ value, label: SPECIALIST_TYPE_LABELS[value] })
);

/** Just the values, in the same order, for a call site that doesn't need labels. */
export const SPECIALIST_TYPES: SpecialistType[] = [...SPECIALIST_TYPE_VALUES];

/** Value -> label lookup, for a call site that renders a badge/table cell rather than a picker. */
export const SPECIALIST_TYPE_LABEL: Record<SpecialistType, string> = SPECIALIST_TYPE_LABELS;
