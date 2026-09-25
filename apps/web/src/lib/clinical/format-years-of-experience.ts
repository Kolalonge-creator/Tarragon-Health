/**
 * Patient-facing credibility line for an attributed doctor — replaces the
 * MDCN/NMCN credential-number display (founder decision 2026-09-25: Nigerian
 * patients don't recognise a registration number as a trust signal).
 * credential_type/credential_number stay on clinical_staff for internal
 * licence verification only (docs/CLINICAL_TRUST_MODEL_SPEC.md §5) — never
 * render them to a patient from a call site using this helper.
 */
export function formatYearsOfExperience(years: number | null | undefined): string | null {
  if (years === null || years === undefined) return null;
  return `${years} ${years === 1 ? "yr" : "yrs"} experience`;
}
