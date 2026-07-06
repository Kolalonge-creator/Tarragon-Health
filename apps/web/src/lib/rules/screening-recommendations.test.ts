import { describe, expect, it } from "@jest/globals";
import {
  computeScreeningRecommendations,
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
};

const HBA1C: ScreenTypeRow = {
  id: "hba1c-id",
  code: "hba1c",
  sex_applicability: "all",
  age_from: 35,
  age_to: null,
  frequency_months: 36,
};

const LIPID_PANEL: ScreenTypeRow = {
  id: "lipid-id",
  code: "lipid_panel",
  sex_applicability: "all",
  age_from: 40,
  age_to: 74,
  frequency_months: 60,
};

const MAMMOGRAPHY: ScreenTypeRow = {
  id: "mammo-id",
  code: "mammography",
  sex_applicability: "female",
  age_from: 40,
  age_to: 74,
  frequency_months: 24,
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
    expect(result).toEqual([{ screenTypeId: "bp-id", screenTypeCode: "blood_pressure", dueDate: "2026-07-06" }]);
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
      { screenTypeId: "hba1c-id", screenTypeCode: "hba1c", dueDate: "2026-07-06" },
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
      { screenTypeId: "lipid-id", screenTypeCode: "lipid_panel", dueDate: "2026-07-06" },
    ]);
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
});
