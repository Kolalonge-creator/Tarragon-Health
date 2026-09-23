import { describe, expect, it } from "@jest/globals";
import {
  computeScreeningRecommendations,
  buildLastCompletedByScreenTypeId,
  type ScreenTypeRow,
  type ScreeningProfile,
} from "./screening-recommendations";
import type { PreventionCondition, RiskTier } from "./risk-scoring";

const BLOOD_PRESSURE: ScreenTypeRow = {
  id: "bp-id",
  code: "blood_pressure",
  sex_applicability: "all",
  age_from: 18,
  age_to: null,
  frequency_months: 24,
  is_optional: false,
};

const HBA1C: ScreenTypeRow = {
  id: "hba1c-id",
  code: "hba1c",
  sex_applicability: "all",
  age_from: 35,
  age_to: null,
  frequency_months: 36,
  is_optional: false,
};

const LIPID_PANEL: ScreenTypeRow = {
  id: "lipid-id",
  code: "lipid_panel",
  sex_applicability: "all",
  age_from: 40,
  age_to: 74,
  frequency_months: 60,
  is_optional: false,
};

const MAMMOGRAPHY: ScreenTypeRow = {
  id: "mammo-id",
  code: "mammography",
  sex_applicability: "female",
  age_from: 40,
  age_to: 74,
  frequency_months: 24,
  is_optional: false,
};

const ANTENATAL_BOOKING: ScreenTypeRow = {
  id: "antenatal-id",
  code: "antenatal_booking",
  sex_applicability: "female",
  age_from: 15,
  age_to: 49,
  frequency_months: null,
  is_optional: false,
};

const PSA: ScreenTypeRow = {
  id: "psa-id",
  code: "psa",
  sex_applicability: "male",
  age_from: 45,
  age_to: null,
  frequency_months: 24,
  is_optional: true,
};

const today = new Date("2026-07-06T00:00:00.000Z");

function tiers(entries: Array<[PreventionCondition, RiskTier]>): Map<PreventionCondition, RiskTier> {
  return new Map(entries);
}

describe("computeScreeningRecommendations", () => {
  it("recommends nothing when age is unknown", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: null };
    const result = computeScreeningRecommendations([BLOOD_PRESSURE], tiers([]), profile, new Map(), today);
    expect(result).toEqual([]);
  });

  it("skips sex-inapplicable screen types", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: 50 };
    const result = computeScreeningRecommendations([MAMMOGRAPHY], tiers([]), profile, new Map(), today);
    expect(result).toEqual([]);
  });

  it("skips screen types below the base age_from", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: 17 };
    const result = computeScreeningRecommendations([BLOOD_PRESSURE], tiers([]), profile, new Map(), today);
    expect(result).toEqual([]);
  });

  it("skips screen types above age_to", () => {
    const profile: ScreeningProfile = { sex: "female", ageYears: 80 };
    const result = computeScreeningRecommendations([MAMMOGRAPHY], tiers([]), profile, new Map(), today);
    expect(result).toEqual([]);
  });

  it("recommends due today when never screened before", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: 30 };
    const result = computeScreeningRecommendations([BLOOD_PRESSURE], tiers([]), profile, new Map(), today);
    expect(result).toEqual([
      { screenTypeId: "bp-id", screenTypeCode: "blood_pressure", dueDate: "2026-07-06", isOptional: false },
    ]);
  });

  it("uses the base 24-month cadence when hypertension tier is low", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: 30 };
    const lastCompleted = new Map([["bp-id", "2025-01-06"]]);
    const result = computeScreeningRecommendations(
      [BLOOD_PRESSURE],
      tiers([["hypertension", "low"]]),
      profile,
      lastCompleted,
      today
    );
    expect(result[0]?.dueDate).toBe("2027-01-06"); // +24 months
  });

  it("tightens blood pressure cadence to 12 months once tier is moderate", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: 30 };
    const lastCompleted = new Map([["bp-id", "2025-07-06"]]);
    const result = computeScreeningRecommendations(
      [BLOOD_PRESSURE],
      tiers([["hypertension", "moderate"]]),
      profile,
      lastCompleted,
      today
    );
    expect(result[0]?.dueDate).toBe("2026-07-06"); // +12 months, not +24
  });

  it("tightens further at high tier the same as moderate (only one escalation step defined)", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: 30 };
    const lastCompleted = new Map([["bp-id", "2025-07-06"]]);
    const result = computeScreeningRecommendations(
      [BLOOD_PRESSURE],
      tiers([["hypertension", "high"]]),
      profile,
      lastCompleted,
      today
    );
    expect(result[0]?.dueDate).toBe("2026-07-06");
  });

  it("lowers the HbA1c start age to 25 once diabetes tier is moderate or high", () => {
    const profile: ScreeningProfile = { sex: "female", ageYears: 28 };
    const lowTierResult = computeScreeningRecommendations(
      [HBA1C],
      tiers([["diabetes", "low"]]),
      profile,
      new Map(),
      today
    );
    expect(lowTierResult).toEqual([]); // below base age_from of 35

    const moderateTierResult = computeScreeningRecommendations(
      [HBA1C],
      tiers([["diabetes", "moderate"]]),
      profile,
      new Map(),
      today
    );
    expect(moderateTierResult).toEqual([
      { screenTypeId: "hba1c-id", screenTypeCode: "hba1c", dueDate: "2026-07-06", isOptional: false },
    ]);
  });

  it("lowers the lipid panel start age to 30 only once cvd tier is high (not moderate)", () => {
    const profile: ScreeningProfile = { sex: "male", ageYears: 32 };
    const moderateTierResult = computeScreeningRecommendations(
      [LIPID_PANEL],
      tiers([["cvd", "moderate"]]),
      profile,
      new Map(),
      today
    );
    expect(moderateTierResult).toEqual([]); // below base age_from of 40, moderate doesn't lower it

    const highTierResult = computeScreeningRecommendations(
      [LIPID_PANEL],
      tiers([["cvd", "high"]]),
      profile,
      new Map(),
      today
    );
    expect(highTierResult).toEqual([
      { screenTypeId: "lipid-id", screenTypeCode: "lipid_panel", dueDate: "2026-07-06", isOptional: false },
    ]);
  });

  describe("antenatal_booking life-stage gate", () => {
    it("never recommends antenatal booking for an eligible woman with no reproductive life stage on file", () => {
      // Regression: a fresh signup (female, 15-49, no reproductive_health_profiles
      // row yet) must not be told they're "due" for antenatal booking off sex+age
      // alone — that presumes pregnancy with zero clinical signal for it.
      const profile: ScreeningProfile = { sex: "female", ageYears: 30, reproductiveLifeStage: null };
      const result = computeScreeningRecommendations([ANTENATAL_BOOKING], tiers([]), profile, new Map(), today);
      expect(result).toEqual([]);
    });

    it("never recommends antenatal booking for a menstruating (non-pregnant) woman", () => {
      const profile: ScreeningProfile = { sex: "female", ageYears: 30, reproductiveLifeStage: "menstruating" };
      const result = computeScreeningRecommendations([ANTENATAL_BOOKING], tiers([]), profile, new Map(), today);
      expect(result).toEqual([]);
    });

    it("recommends antenatal booking once the patient has self-reported pregnant", () => {
      const profile: ScreeningProfile = { sex: "female", ageYears: 30, reproductiveLifeStage: "pregnant" };
      const result = computeScreeningRecommendations([ANTENATAL_BOOKING], tiers([]), profile, new Map(), today);
      expect(result).toEqual([
        { screenTypeId: "antenatal-id", screenTypeCode: "antenatal_booking", dueDate: "2026-07-06", isOptional: false },
      ]);
    });

    it("does not gate an unrelated screen type on reproductive life stage", () => {
      const profile: ScreeningProfile = { sex: "female", ageYears: 50, reproductiveLifeStage: null };
      const result = computeScreeningRecommendations([MAMMOGRAPHY], tiers([]), profile, new Map(), today);
      expect(result).toEqual([
        { screenTypeId: "mammo-id", screenTypeCode: "mammography", dueDate: "2026-07-06", isOptional: false },
      ]);
    });
  });

  it("never recommends a one-off screening again once completed", () => {
    const oneOff: ScreenTypeRow = { ...HBA1C, code: "hep_b", frequency_months: null };
    const profile: ScreeningProfile = { sex: "male", ageYears: 40 };
    const result = computeScreeningRecommendations(
      [oneOff],
      tiers([]),
      profile,
      new Map([["hba1c-id", "2020-01-01"]]),
      today
    );
    expect(result).toEqual([]);
  });

  describe("is_optional", () => {
    // Regression: screen_types.is_optional ("Offered when due, never
    // assumed. The patient opts in rather than finding it already inside
    // their review.") was carried by the catalogue but never read by this
    // engine — every eligible patient got an optional screen (PSA, dental,
    // ferritin, TFT, vitamin B12) auto-scheduled exactly like a mandatory
    // one. The engine still computes a due recommendation for an optional
    // screen type (so a caller can offer it with a real date) — it's the
    // caller's job (actions.ts) to skip auto-inserting it.
    it("still computes a recommendation for an optional screen type, flagged isOptional", () => {
      const profile: ScreeningProfile = { sex: "male", ageYears: 50 };
      const result = computeScreeningRecommendations([PSA], tiers([]), profile, new Map(), today);
      expect(result).toEqual([
        { screenTypeId: "psa-id", screenTypeCode: "psa", dueDate: "2026-07-06", isOptional: true },
      ]);
    });

    it("flags a mandatory screen type isOptional: false", () => {
      const profile: ScreeningProfile = { sex: "male", ageYears: 30 };
      const result = computeScreeningRecommendations([BLOOD_PRESSURE], tiers([]), profile, new Map(), today);
      expect(result[0]?.isOptional).toBe(false);
    });

    it("still applies ordinary sex/age eligibility to an optional screen type", () => {
      const profile: ScreeningProfile = { sex: "female", ageYears: 50 };
      const result = computeScreeningRecommendations([PSA], tiers([]), profile, new Map(), today);
      expect(result).toEqual([]); // PSA is male-only regardless of is_optional
    });
  });
});

describe("buildLastCompletedByScreenTypeId", () => {
  // Extracted from actions.ts's submitRiskAssessment (2026-09-22 /code-review
  // finding: the same "keep the latest due_date where status === 'completed'"
  // loop was duplicated verbatim in the new useOptionalScreeningOffers hook).
  // Both callers now share this one implementation.
  it("returns an empty map when there are no completed rows", () => {
    const result = buildLastCompletedByScreenTypeId([
      { screen_type_id: "bp-id", status: "pending", due_date: "2026-07-06" },
      { screen_type_id: "bp-id", status: "declined", due_date: "2026-07-06" },
    ]);
    expect(result.size).toBe(0);
  });

  it("keeps the latest due_date among multiple completed rows for the same screen type", () => {
    const result = buildLastCompletedByScreenTypeId([
      { screen_type_id: "hba1c-id", status: "completed", due_date: "2024-01-01" },
      { screen_type_id: "hba1c-id", status: "completed", due_date: "2025-06-15" },
      { screen_type_id: "hba1c-id", status: "completed", due_date: "2023-03-01" },
    ]);
    expect(result.get("hba1c-id")).toBe("2025-06-15");
  });

  it("keeps separate entries per screen type", () => {
    const result = buildLastCompletedByScreenTypeId([
      { screen_type_id: "hba1c-id", status: "completed", due_date: "2025-01-01" },
      { screen_type_id: "lipid-id", status: "completed", due_date: "2024-06-01" },
    ]);
    expect(result.get("hba1c-id")).toBe("2025-01-01");
    expect(result.get("lipid-id")).toBe("2024-06-01");
  });
});
