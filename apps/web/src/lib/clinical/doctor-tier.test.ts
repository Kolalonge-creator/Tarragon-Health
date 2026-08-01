import { canConfirmMedicationRefill, hasPrescribingAuthority } from "./doctor-tier";

type Staff = Parameters<typeof hasPrescribingAuthority>[0];

const staff = (
  doctor_tier: NonNullable<Staff>["doctor_tier"],
  is_clinical_director = false,
): Staff => ({ doctor_tier, is_clinical_director });

/**
 * The ladder in order, so the monotonicity assertion below reads as the real
 * invariant rather than a hand-written list of expected booleans. Mirrors
 * packages/db/tests/tier_authority_monotonicity.sql, which enforces the same
 * property against the database itself.
 */
const CLINICAL_LADDER = [
  "tier_1",
  "tier_2",
  "tier_3",
  "tier_4_senior_registrar",
  "tier_5_partner_specialist",
] as const;

describe("hasPrescribingAuthority", () => {
  it("denies Tier 1 and admits Tier 2 and above", () => {
    expect(hasPrescribingAuthority(staff("tier_1"))).toBe(false);
    expect(hasPrescribingAuthority(staff("tier_2"))).toBe(true);
    expect(hasPrescribingAuthority(staff("tier_5_partner_specialist"))).toBe(true);
  });

  it("admits a Clinical Director with no tier at all", () => {
    expect(hasPrescribingAuthority(staff(null, true))).toBe(true);
  });

  it("denies a care coordinator and a null record", () => {
    expect(hasPrescribingAuthority(staff("care_coordinator"))).toBe(false);
    expect(hasPrescribingAuthority(null)).toBe(false);
  });
});

describe("canConfirmMedicationRefill", () => {
  it("admits every clinical tier, not just Tier 1", () => {
    // The regression this exists to prevent: written as an equality
    // (`doctor_tier === 'tier_1'`), a senior doctor covering a shift with no
    // Tier 1 on duty could not confirm a routine refill.
    for (const tier of CLINICAL_LADDER) {
      expect(canConfirmMedicationRefill(staff(tier))).toBe(true);
    }
  });

  it("admits a Clinical Director with no tier at all", () => {
    expect(canConfirmMedicationRefill(staff(null, true))).toBe(true);
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

describe("tier authority is monotonic", () => {
  it("never allows a lower tier something a higher tier is denied", () => {
    const gates = { hasPrescribingAuthority, canConfirmMedicationRefill };

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
