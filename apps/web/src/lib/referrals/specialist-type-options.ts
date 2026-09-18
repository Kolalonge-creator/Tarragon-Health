import type { SpecialistType } from "@tarragon/shared";

/**
 * The full specialist_type enum, labelled for UI use — every value the
 * column can hold, not a curated subset. Shared by the referral-creation
 * form (create-referral-form.tsx) and the referrals worklist's filter
 * (clinician/referrals/page.tsx) so the two never drift the way they did
 * before this file existed: create-referral-form.tsx's own copy of this
 * list was missing `genitourinary_medicine` (a real, selectable
 * specialist_type value) until this fix, meaning a clinician could not
 * actually create a referral to that specialty from the creation form even
 * though the column supported it.
 *
 * `SPECIALIST_TYPE_LABEL` is `satisfies Record<SpecialistType, string>` —
 * dropping an enum member here (or forgetting to add a new one the next
 * time `specialist_type` gains a value) is a compile-time error, not
 * something that only surfaces the next time someone happens to check the
 * dropdown. See specialist-type-options.test.ts for the accompanying
 * regression test (CLAUDE.md: "every confirmed bug fix gets a standing
 * regression test") — it locks in the specific bug this fixed
 * (`genitourinary_medicine` missing) rather than relying on the type check
 * alone, since a future refactor could drop the `satisfies` clause itself.
 */
export const SPECIALIST_TYPE_LABEL = {
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
  genitourinary_medicine: "Genitourinary medicine",
  other: "Other",
} satisfies Record<SpecialistType, string>;

export const SPECIALIST_TYPE_OPTIONS: { value: SpecialistType; label: string }[] = (
  Object.entries(SPECIALIST_TYPE_LABEL) as [SpecialistType, string][]
).map(([value, label]) => ({ value, label }));
