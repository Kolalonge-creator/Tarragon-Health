import type { Tables } from "@tarragon/shared";

type DoctorTier = NonNullable<Tables<"clinical_staff">["doctor_tier"]>;

/** docs/Tarragon_Health_Master_Operating_Plan_v4.md §4 — the 5-tier doctor ladder plus Care Coordinator. */
export const DOCTOR_TIER_LABEL: Record<DoctorTier, string> = {
  care_coordinator: "Care Coordinator",
  tier_1: "Tier 1 — Medical Officer (<3yrs)",
  tier_2: "Tier 2 — Medical Officer (3+yrs)",
  tier_3: "Tier 3 — Senior Medical Officer",
  tier_4_senior_registrar: "Tier 4 — Senior Registrar",
  tier_5_partner_specialist: "Tier 5 — Partner Specialist",
};

/** Short blurb of each tier's clinical authority — master plan §4's role table, patient/staff-facing tone. */
export const DOCTOR_TIER_AUTHORITY_BLURB: Partial<Record<DoctorTier, string>> = {
  tier_1:
    "First-line review of routine, in-protocol readings and stable follow-up. Confirms and continues existing stable prescriptions — starting a new medication needs Tier 2 or above.",
  tier_2:
    "Initiates new medications and standard dose adjustments per protocol; handles escalations Tier 1 flags.",
  tier_3:
    "Complex, multi-drug case management; spot-audits Tier 1 and Tier 2 decisions.",
  tier_4_senior_registrar:
    "Pre-referral consults, sets referral urgency, approves referrals, owns clinical protocols, supervises Tiers 1–3.",
  tier_5_partner_specialist:
    "Complex/procedural input on referral, telemedicine-first — hands routine follow-up back to Tier 3/4.",
};

type PrescribingAuthority = Pick<
  Tables<"clinical_staff">,
  "doctor_tier" | "is_clinical_director"
>;

const PRESCRIBING_TIERS: DoctorTier[] = [
  "tier_2",
  "tier_3",
  "tier_4_senior_registrar",
  "tier_5_partner_specialist",
];

/**
 * Mirrors private.has_prescribing_authority() (20260715181500_pharmacy_authority_by_tier.sql)
 * — Tier 1 confirms/continues existing prescriptions but never initiates or
 * changes one (docs/Tarragon_Health_Master_Operating_Plan_v4.md §4/§8).
 * This copy only gates the UI with a friendly explanation; the DB RLS
 * policy is the real enforcement boundary.
 */
export function hasPrescribingAuthority(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return (
    staff.is_clinical_director ||
    (staff.doctor_tier !== null && PRESCRIBING_TIERS.includes(staff.doctor_tier))
  );
}

/**
 * Every clinical tier, in ladder order. `care_coordinator` is deliberately
 * absent: it is a doctor_tier value but is explicitly non-clinical and must
 * never gain medication write access. Listing the clinical tiers rather than
 * excluding the one non-clinical value means a tier added to the enum later is
 * excluded by default instead of silently admitted.
 */
const CLINICAL_TIERS: DoctorTier[] = [
  "tier_1",
  "tier_2",
  "tier_3",
  "tier_4_senior_registrar",
  "tier_5_partner_specialist",
];

/**
 * Mirrors private.can_confirm_medication_refill()
 * (20260801001234_refill_confirm_any_clinical_tier.sql) — any clinical tier or
 * the Clinical Director may confirm and continue an existing
 * clinician-prescribed medication.
 *
 * This is NOT Tier-1-exclusive, and the distinction is load-bearing: clinical
 * authority is monotonic, so a higher tier can always do everything a lower
 * tier can (packages/db/tests/tier_authority_monotonicity.sql). A Tier 4
 * covering a shift with no Tier 1 on duty must still be able to confirm a
 * routine refill, and useConfirmMedicationRefill is the only write path to
 * refill_date anywhere in the app — AddMedicationForm creates new medications
 * and StopMedication stops them, so without this the capability would simply
 * be unreachable for a senior doctor.
 *
 * This copy only decides whether to render the control. medications_update's
 * RLS policy plus private.enforce_medication_confirm_only remain the real
 * enforcement boundary: confirming may only move refill_date, and changing
 * drug/dose/frequency/status still requires prescribing authority.
 */
export function canConfirmMedicationRefill(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return (
    staff.is_clinical_director ||
    (staff.doctor_tier !== null && CLINICAL_TIERS.includes(staff.doctor_tier))
  );
}
