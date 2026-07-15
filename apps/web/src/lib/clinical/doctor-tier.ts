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
