import type { Tables } from "@tarragon/shared";

type DoctorTier = NonNullable<Tables<"clinical_staff">["doctor_tier"]>;

/**
 * docs/Tarragon_Health_Master_Operating_Plan_v4.md §4 — the 3-tier doctor
 * ladder plus Care Coordinator. `is_clinical_director` no longer exists as a
 * separate governance flag (retired alongside the tier collapse); director
 * authority is intrinsic to `chief_medical_officer`.
 */
export const DOCTOR_TIER_LABEL: Record<DoctorTier, string> = {
  care_coordinator: "Care Coordinator",
  medical_officer: "Medical Officer",
  senior_medical_officer: "Senior Medical Officer / Specialist",
  chief_medical_officer: "Chief Medical Officer / Clinical Director",
};

/** Short blurb of each tier's clinical authority — master plan §4's role table, patient/staff-facing tone. */
export const DOCTOR_TIER_AUTHORITY_BLURB: Partial<Record<DoctorTier, string>> = {
  medical_officer:
    "Standard, protocol-driven consultations within their own patient list. Confirms and continues existing stable prescriptions; starting a new medication or handling a complex case goes to Senior Medical Officer.",
  senior_medical_officer:
    "Everything a Medical Officer does, plus complex and specialist cases, initiating new medications, and referrals a Medical Officer flags on difficulty.",
  chief_medical_officer:
    "Everything the tiers above do, plus assigning cases to other doctors and specialists, visibility into the whole team's caseload, and clinical-governance authority (protocol sign-off, indemnity oversight).",
};

type PrescribingAuthority = Pick<Tables<"clinical_staff">, "doctor_tier">;

const PRESCRIBING_TIERS: DoctorTier[] = ["senior_medical_officer", "chief_medical_officer"];

/**
 * Mirrors private.has_prescribing_authority() (20260715181500_pharmacy_authority_by_tier.sql,
 * updated by the tier-collapse migration) — Medical Officer confirms/
 * continues existing prescriptions but never initiates or changes one
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4/§8). This copy only
 * gates the UI with a friendly explanation; the DB RLS policy is the real
 * enforcement boundary.
 */
export function hasPrescribingAuthority(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return staff.doctor_tier !== null && PRESCRIBING_TIERS.includes(staff.doctor_tier);
}

/**
 * Every clinical tier, in ladder order. `care_coordinator` is deliberately
 * absent: it is a doctor_tier value but is explicitly non-clinical and must
 * never gain medication write access. Listing the clinical tiers rather than
 * excluding the one non-clinical value means a tier added to the enum later is
 * excluded by default instead of silently admitted.
 */
const CLINICAL_TIERS: DoctorTier[] = [
  "medical_officer",
  "senior_medical_officer",
  "chief_medical_officer",
];

/**
 * Same tier list as PRESCRIBING_TIERS today, deliberately a separate
 * constant: these gate different clinical acts (initiating a medication vs.
 * closing an emergency case) and should be free to diverge without one
 * silently changing the other. The DB keeps the same separation —
 * private.has_prescribing_authority and
 * private.can_handle_emergency_escalation are two functions, not one.
 */
const EMERGENCY_ESCALATION_TIERS: DoctorTier[] = ["senior_medical_officer", "chief_medical_officer"];

/** Only the Chief Medical Officer / Clinical Director may act on this. */
const GOVERNANCE_TIERS: DoctorTier[] = ["chief_medical_officer"];

/**
 * True for anyone who may act as a doctor in the clinical sense: any tier on
 * the ladder. False for `care_coordinator` (a doctor_tier value, but
 * explicitly non-clinical — see CLINICAL_TIERS above) and for a null tier.
 * Use this, not a bare truthy `staff` check, to gate any UI that must never
 * reach a Care Coordinator even though they carry an active clinical_staff
 * row (added alongside the doctor-tier ladder, 20260715172711) — a plain
 * `staff &&` gate silently admits them.
 */
export function isClinicalTier(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return staff.doctor_tier !== null && CLINICAL_TIERS.includes(staff.doctor_tier);
}

/**
 * Mirrors private.can_confirm_medication_refill()
 * (20260801001234_refill_confirm_any_clinical_tier.sql) — any clinical tier
 * may confirm and continue an existing clinician-prescribed medication.
 *
 * This is NOT Medical-Officer-exclusive, and the distinction is load-bearing:
 * clinical authority is monotonic, so a higher tier can always do everything
 * a lower tier can (packages/db/tests/tier_authority_monotonicity.sql). A
 * Chief Medical Officer covering a shift with no Medical Officer on duty must
 * still be able to confirm a routine refill, and useConfirmMedicationRefill
 * is the only write path to refill_date anywhere in the app —
 * AddMedicationForm creates new medications and StopMedication stops them,
 * so without this the capability would simply be unreachable for a senior
 * doctor.
 *
 * This copy only decides whether to render the control. medications_update's
 * RLS policy plus private.enforce_medication_confirm_only remain the real
 * enforcement boundary: confirming may only move refill_date, and changing
 * drug/dose/frequency/status still requires prescribing authority.
 */
export function canConfirmMedicationRefill(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return staff.doctor_tier !== null && CLINICAL_TIERS.includes(staff.doctor_tier);
}

/**
 * Mirrors private.can_handle_emergency_escalation(org)
 * (20260731021500_emergency_escalation_tier_gate.sql, updated by the
 * tier-collapse migration) — an emergency-level escalation can only be
 * CLAIMED or RESOLVED by Senior Medical Officer+. Everything else about the
 * case (reading it, notes, starting a virtual review, overriding the
 * classification, referring it on) is open to every tier.
 *
 * Introduced alongside the doctor->clinician account role merge
 * (20260731020000): before that merge only a Tier 4/5 'doctor'-role account
 * could reach the escalation queue at all, so the account-role split was
 * acting as an authority gate by accident. Unifying page access without this
 * would have newly let a Medical Officer close an emergency.
 *
 * This copy only gates the UI so a Medical Officer gets a friendly
 * explanation rather than a raw RLS/trigger error — exactly the
 * hasPrescribingAuthority pattern. The DB trigger
 * (escalations_enforce_emergency_authority) is the real enforcement
 * boundary.
 */
export function canHandleEmergencyEscalation(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return staff.doctor_tier !== null && EMERGENCY_ESCALATION_TIERS.includes(staff.doctor_tier);
}

/**
 * True only for the Chief Medical Officer / Clinical Director. Gates
 * reassigning a case (escalation or clinician alert) to someone OTHER than
 * yourself — self-claim stays open to any clinical tier via isClinicalTier /
 * canHandleEmergencyEscalation, unchanged. Mirrors the BEFORE UPDATE trigger
 * added on escalations/clinician_alerts by the tier-collapse migration; this
 * copy only gates the UI's "Assign to…" control.
 */
export function canAssignCases(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return staff.doctor_tier !== null && GOVERNANCE_TIERS.includes(staff.doctor_tier);
}
