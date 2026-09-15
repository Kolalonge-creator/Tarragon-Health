import type { Tables } from "./database.types";

export type DoctorTier = NonNullable<Tables<"clinical_staff">["doctor_tier"]>;

type ClinicalTierCheckInput = { doctor_tier: DoctorTier | null } | null;

/**
 * Every clinical tier, in ladder order. `care_coordinator` is deliberately
 * absent: it is a doctor_tier value but is explicitly non-clinical and must
 * never gain medication write access or be shown as "Dr." anywhere.
 * Listing the clinical tiers rather than excluding the one non-clinical
 * value means a tier added to the enum later is excluded by default instead
 * of silently admitted -- see the tier-authority-monotonic-invariant memory:
 * gates here are floors ("tier N+"), never fences, and this allowlist is
 * what keeps that true automatically as the ladder grows.
 *
 * Moved here from apps/web/src/lib/clinical/doctor-tier.ts (which now
 * re-exports it) so a mobile screen attributing an event to "Dr. X" reads
 * the identical list rather than a second hand-copied one that could drift.
 * This copy is UI-only display-gating on both platforms; the DB RLS policy
 * (private.has_prescribing_authority / private.can_handle_emergency_escalation)
 * remains the real enforcement boundary.
 */
export const CLINICAL_TIERS: DoctorTier[] = [
  "medical_officer",
  "senior_medical_officer",
  "chief_medical_officer",
];

export function isClinicalTier(staff: ClinicalTierCheckInput): boolean {
  if (!staff) return false;
  return staff.doctor_tier !== null && CLINICAL_TIERS.includes(staff.doctor_tier);
}
