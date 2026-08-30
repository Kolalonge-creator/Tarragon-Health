import {
  canAssignCases,
  canConfirmMedicationRefill,
  canHandleEmergencyEscalation,
  hasPrescribingAuthority,
} from "./doctor-tier";

type Staff = Parameters<typeof hasPrescribingAuthority>[0];

const staff = (doctor_tier: NonNullable<Staff>["doctor_tier"]): Staff => ({ doctor_tier });

/**
 * The ladder in order, so the monotonicity assertion below reads as the real
 * invariant rather than a hand-written list of expected booleans. Mirrors
 * packages/db/tests/tier_authority_monotonicity.sql, which enforces the same
 * property against the database itself. `is_clinical_director` no longer
 * exists as a separate flag — Chief Medical Officer is the top rung, not an
 * orthogonal governance layer.
 */
const CLINICAL_LADDER = [
  "medical_officer",
  "senior_medical_officer",
  "chief_medical_officer",
] as const;

describe("hasPrescribingAuthority", () => {
  it("denies Medical Officer and admits Senior Medical Officer and above", () => {
    expect(hasPrescribingAuthority(staff("medical_officer"))).toBe(false);
    expect(hasPrescribingAuthority(staff("senior_medical_officer"))).toBe(true);
    expect(hasPrescribingAuthority(staff("chief_medical_officer"))).toBe(true);
  });

  it("denies a care coordinator and a null record", () => {
    expect(hasPrescribingAuthority(staff("care_coordinator"))).toBe(false);
    expect(hasPrescribingAuthority(null)).toBe(false);
  });
});

describe("canConfirmMedicationRefill", () => {
  it("admits every clinical tier, not just Medical Officer", () => {
    // The regression this exists to prevent: written as an equality
    // (`doctor_tier === 'medical_officer'`), a senior doctor covering a
    // shift with no Medical Officer on duty could not confirm a routine
    // refill.
    for (const tier of CLINICAL_LADDER) {
      expect(canConfirmMedicationRefill(staff(tier))).toBe(true);
    }
  });

  it("denies a care coordinator", () => {
    // A doctor_tier value, but explicitly non-clinical: it must never gain
    // medication write access.
    expect(canConfirmMedicationRefill(staff("care_coordinator"))).toBe(false);
  });

  it("denies a null record and a record with no tier", () => {
    expect(canConfirmMedicationRefill(null)).toBe(false);
    expect(canConfirmMedicationRefill(staff(null))).toBe(false);
  });
});

/**
 * Mirrors private.can_handle_emergency_escalation (updated by the
 * tier-collapse migration) — an emergency-level escalation can only be
 * CLAIMED or RESOLVED by Senior Medical Officer+. Introduced alongside the
 * doctor->clinician account role merge (20260731020000): before that merge
 * only a Tier 4/5 'doctor'-role account could reach the escalation queue at
 * all, so the account-role split was gating this by accident. Unifying page
 * access without this check would have newly let a Medical Officer close an
 * emergency.
 */
describe("canHandleEmergencyEscalation", () => {
  it("refuses Medical Officer — the case the doctor->clinician role merge created", () => {
    expect(canHandleEmergencyEscalation(staff("medical_officer"))).toBe(false);
  });

  it("refuses a Care Coordinator outright", () => {
    expect(canHandleEmergencyEscalation(staff("care_coordinator"))).toBe(false);
  });

  it("allows Senior Medical Officer and Chief Medical Officer", () => {
    for (const tier of ["senior_medical_officer", "chief_medical_officer"] as const) {
      expect(canHandleEmergencyEscalation(staff(tier))).toBe(true);
    }
  });

  it("refuses an account with no clinical_staff row at all, never inferring a tier", () => {
    // CLAUDE.md: "never infer or default a doctor_tier in code."
    expect(canHandleEmergencyEscalation(null)).toBe(false);
    expect(canHandleEmergencyEscalation(staff(null))).toBe(false);
  });
});

/**
 * canAssignCases is intentionally the narrowest gate on the ladder — Chief
 * Medical Officer only, not "Senior Medical Officer and above" like the
 * other three. It governs reassigning a case to someone OTHER than yourself;
 * self-claim stays open to any clinical tier via isClinicalTier/
 * canHandleEmergencyEscalation.
 */
describe("canAssignCases", () => {
  it("admits only Chief Medical Officer", () => {
    expect(canAssignCases(staff("chief_medical_officer"))).toBe(true);
    expect(canAssignCases(staff("senior_medical_officer"))).toBe(false);
    expect(canAssignCases(staff("medical_officer"))).toBe(false);
    expect(canAssignCases(staff("care_coordinator"))).toBe(false);
  });

  it("refuses a null record and a record with no tier", () => {
    expect(canAssignCases(null)).toBe(false);
    expect(canAssignCases(staff(null))).toBe(false);
  });
});

describe("tier authority is monotonic", () => {
  it("never allows a lower tier something a higher tier is denied", () => {
    const gates = {
      hasPrescribingAuthority,
      canConfirmMedicationRefill,
      canHandleEmergencyEscalation,
      canAssignCases,
    };

    for (const [name, gate] of Object.entries(gates)) {
      for (let lo = 0; lo < CLINICAL_LADDER.length; lo += 1) {
        for (let hi = lo + 1; hi < CLINICAL_LADDER.length; hi += 1) {
          const lower = gate(staff(CLINICAL_LADDER[lo]));
          const higher = gate(staff(CLINICAL_LADDER[hi]));
          expect({
            gate: name,
            lower: CLINICAL_LADDER[lo],
            higher: CLINICAL_LADDER[hi],
            violation: lower && !higher,
          }).toEqual({
            gate: name,
            lower: CLINICAL_LADDER[lo],
            higher: CLINICAL_LADDER[hi],
            violation: false,
          });
        }
      }
    }
  });
});
