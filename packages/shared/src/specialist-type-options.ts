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

/** Value -> label lookup, for a call site that renders a badge/table cell rather than a picker. */
export const SPECIALIST_TYPE_LABEL: Record<SpecialistType, string> = SPECIALIST_TYPE_OPTIONS.reduce(
  (acc, o) => {
    acc[o.value] = o.label;
    return acc;
  },
  {} as Record<SpecialistType, string>
);
