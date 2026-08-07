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
 * Same tier list as PRESCRIBING_TIERS today, deliberately a separate
 * constant: these gate different clinical acts (initiating a medication vs.
 * closing an emergency case) and should be free to diverge without one
 * silently changing the other. The DB keeps the same separation —
 * private.has_prescribing_authority and
 * private.can_handle_emergency_escalation are two functions, not one.
 */
const EMERGENCY_ESCALATION_TIERS: DoctorTier[] = [
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

/**
 * Mirrors private.can_handle_emergency_escalation(org)
 * (20260731021500_emergency_escalation_tier_gate.sql) — an emergency-level
 * escalation can only be CLAIMED or RESOLVED by Tier 2+ or the org's
 * Clinical Director. Everything else about the case (reading it, notes,
 * starting a virtual review, overriding the classification, referring it on)
 * is open to every tier.
 *
 * Introduced alongside the doctor->clinician account role merge
 * (20260731020000): before that merge only a Tier 4/5 'doctor'-role account
 * could reach the escalation queue at all, so the account-role split was
 * acting as an authority gate by accident. Unifying page access without this
 * would have newly let a Tier 1 close an emergency.
 *
 * This copy only gates the UI so a Tier 1 gets a friendly explanation rather
 * than a raw RLS/trigger error — exactly the hasPrescribingAuthority
 * pattern. The DB trigger (escalations_enforce_emergency_authority) is the
 * real enforcement boundary.
 */
export function canHandleEmergencyEscalation(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return (
    staff.is_clinical_director ||
    (staff.doctor_tier !== null && EMERGENCY_ESCALATION_TIERS.includes(staff.doctor_tier))
  );
}

/**
 * Same tier list again, deliberately its own constant for the third time: these
 * gate different clinical acts (initiating a medication, closing an emergency
 * case, attesting a whole record to an outside institution) and must be free to
 * diverge without one silently changing another. The DB keeps the same
 * separation — three functions, not one.
 */
const PASSPORT_ATTESTATION_TIERS: DoctorTier[] = [
  "tier_2",
  "tier_3",
  "tier_4_senior_registrar",
  "tier_5_partner_specialist",
];

type PassportAttestationAuthority = PrescribingAuthority &
  Pick<
    Tables<"clinical_staff">,
    "credential_type" | "credential_number" | "credential_verified_at"
  >;

/**
 * Mirrors private.can_attest_health_passport(org) — Tier 2+ or the org's
 * Clinical Director may attest a Health Passport for use outside TarragonHealth.
 *
 * Attesting is a broader statement than any single-case decision: it puts a
 * named doctor's registration number against a whole record, in front of an
 * institution that has no other way to judge it. So it sits with
 * emergency-escalation authority rather than with first-line review.
 *
 * This copy only decides whether to render the control.
 * `attest_health_passport_request` is the enforcement boundary and applies the
 * same tier test plus the credential requirement below.
 */
export function canAttestHealthPassport(staff: PrescribingAuthority | null): boolean {
  if (!staff) return false;
  return (
    staff.is_clinical_director ||
    (staff.doctor_tier !== null && PASSPORT_ATTESTATION_TIERS.includes(staff.doctor_tier))
  );
}

/**
 * Is a registration number on this record at all?
 *
 * The weaker of the two credential conditions, kept separate so the UI can tell
 * a doctor which one they are actually missing — "you have no number on file"
 * and "your number has not been checked yet" need different people to fix them.
 */
export function hasCredentialOnRecord(staff: PassportAttestationAuthority | null): boolean {
  if (!staff) return false;
  return (
    typeof staff.credential_type === "string" &&
    staff.credential_type.trim().length > 0 &&
    typeof staff.credential_number === "string" &&
    staff.credential_number.trim().length > 0
  );
}

/**
 * The load-bearing gate: a doctor may only attest a Health Passport once their
 * registration number has been CHECKED by an administrator, not merely typed in.
 *
 * An attested passport exists to be read by an embassy or a hospital that has
 * never heard of TarragonHealth. It tells them a doctor holds registration N. If
 * the only thing behind N is that somebody typed it into a form, the document
 * makes a claim nobody stands behind — which is precisely the unverifiable claim
 * this whole feature was built to stop making. So the bar is a recorded
 * verification act: a named admin, on a date, who is not the doctor themselves.
 *
 * Deliberately NOT `license_verified_at`. That column gates activation and is
 * legitimately set on records with no registration at all (a Care Coordinator is
 * active, employed and has no MDCN number). See the migration header for why
 * conflating the two would break real accounts.
 *
 * The database enforces this three ways, so this copy only shapes the UI:
 * `attest_health_passport_request` refuses, `mint_health_passport` re-checks at
 * issue, and `health_passport_attestation_complete` refuses to store an
 * attestation missing a number even if both were bypassed.
 */
export function hasAttestableCredential(staff: PassportAttestationAuthority | null): boolean {
  return hasCredentialOnRecord(staff) && staff?.credential_verified_at != null;
}
