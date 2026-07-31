import { describe, expect, it } from "@jest/globals";
import { canHandleEmergencyEscalation, hasPrescribingAuthority } from "./doctor-tier";

/**
 * Both helpers mirror a DB gate and are easy to confuse with each other, so
 * they are pinned side by side here: hasPrescribingAuthority mirrors
 * private.has_prescribing_authority, canHandleEmergencyEscalation mirrors
 * private.can_handle_emergency_escalation. Identical tier lists today, two
 * functions on purpose.
 */
describe("canHandleEmergencyEscalation", () => {
  it("refuses Tier 1 — the case the doctor->clinician role merge created", () => {
    // Before 20260731020000 a Tier 1 could not reach the escalation queue at
    // all, so the account-role split gated this by accident. Unifying page
    // access without this check would newly let a Tier 1 close an emergency.
    expect(
      canHandleEmergencyEscalation({ doctor_tier: "tier_1", is_clinical_director: false })
    ).toBe(false);
  });

  it("refuses a Care Coordinator outright", () => {
    expect(
      canHandleEmergencyEscalation({ doctor_tier: "care_coordinator", is_clinical_director: false })
    ).toBe(false);
  });

  it("allows Tier 2 through Tier 5", () => {
    for (const tier of [
      "tier_2",
      "tier_3",
      "tier_4_senior_registrar",
      "tier_5_partner_specialist",
    ] as const) {
      expect(canHandleEmergencyEscalation({ doctor_tier: tier, is_clinical_director: false })).toBe(
        true
      );
    }
  });

  it("allows a Clinical Director with no tier recorded at all", () => {
    // is_clinical_director is an orthogonal governance flag, not a rung on
    // the ladder (CLAUDE.md's Clinical Tier Ladder note) — a Director can sit
    // at any tier, or none.
    expect(
      canHandleEmergencyEscalation({ doctor_tier: null, is_clinical_director: true })
    ).toBe(true);
  });

  it("refuses an account with no clinical_staff row at all, never inferring a tier", () => {
    // CLAUDE.md: "never infer or default a doctor_tier in code."
    expect(canHandleEmergencyEscalation(null)).toBe(false);
    expect(
      canHandleEmergencyEscalation({ doctor_tier: null, is_clinical_director: false })
    ).toBe(false);
  });
});

describe("hasPrescribingAuthority (regression guard alongside the new gate)", () => {
  it("still refuses Tier 1 and allows Tier 2+/Director", () => {
    expect(hasPrescribingAuthority({ doctor_tier: "tier_1", is_clinical_director: false })).toBe(
      false
    );
    expect(hasPrescribingAuthority({ doctor_tier: "tier_2", is_clinical_director: false })).toBe(
      true
    );
    expect(hasPrescribingAuthority({ doctor_tier: null, is_clinical_director: true })).toBe(true);
    expect(hasPrescribingAuthority(null)).toBe(false);
  });
});
