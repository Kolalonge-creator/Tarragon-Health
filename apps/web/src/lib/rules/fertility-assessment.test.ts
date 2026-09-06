import { recommendFertilityAction } from "./fertility-assessment";

describe("recommendFertilityAction", () => {
  it("recommends education_only under 6 months trying, regardless of age", () => {
    expect(
      recommendFertilityAction({ tryingDurationMonths: 0, ageYears: 28, knownRiskFactors: [] })
    ).toBe("education_only");
    expect(
      recommendFertilityAction({ tryingDurationMonths: 5, ageYears: null, knownRiskFactors: [] })
    ).toBe("education_only");
    expect(
      recommendFertilityAction({ tryingDurationMonths: 5, ageYears: 40, knownRiskFactors: [] })
    ).toBe("education_only");
  });

  it("recommends preconception_advice for 6-11 months trying when age is known and under 35", () => {
    expect(
      recommendFertilityAction({ tryingDurationMonths: 6, ageYears: 30, knownRiskFactors: [] })
    ).toBe("preconception_advice");
    expect(
      recommendFertilityAction({ tryingDurationMonths: 11, ageYears: 34, knownRiskFactors: [] })
    ).toBe("preconception_advice");
  });

  it("recommends baseline_labs for 6-11 months trying when age is unknown", () => {
    expect(
      recommendFertilityAction({ tryingDurationMonths: 6, ageYears: null, knownRiskFactors: [] })
    ).toBe("baseline_labs");
    expect(
      recommendFertilityAction({ tryingDurationMonths: 11, ageYears: null, knownRiskFactors: [] })
    ).toBe("baseline_labs");
  });

  it("recommends specialist_referral at 12+ months trying, regardless of age", () => {
    expect(
      recommendFertilityAction({ tryingDurationMonths: 12, ageYears: 29, knownRiskFactors: [] })
    ).toBe("specialist_referral");
    expect(
      recommendFertilityAction({ tryingDurationMonths: 120, ageYears: null, knownRiskFactors: [] })
    ).toBe("specialist_referral");
  });

  it("applies the age-35 shortcut: 6-11 months trying refers early when age is 35+", () => {
    expect(
      recommendFertilityAction({ tryingDurationMonths: 6, ageYears: 35, knownRiskFactors: [] })
    ).toBe("specialist_referral");
    expect(
      recommendFertilityAction({ tryingDurationMonths: 11, ageYears: 41, knownRiskFactors: [] })
    ).toBe("specialist_referral");
    // Below the shortcut age, the plain 6-11 rule applies instead.
    expect(
      recommendFertilityAction({ tryingDurationMonths: 6, ageYears: 34, knownRiskFactors: [] })
    ).toBe("preconception_advice");
  });

  it("overrides everything to specialist_referral when any real risk factor is present", () => {
    expect(
      recommendFertilityAction({ tryingDurationMonths: 0, ageYears: 22, knownRiskFactors: ["pcos"] })
    ).toBe("specialist_referral");
    expect(
      recommendFertilityAction({
        tryingDurationMonths: 2,
        ageYears: null,
        knownRiskFactors: ["low_sperm_count_history"],
      })
    ).toBe("specialist_referral");
    // "none" alone is not a real risk factor and does not trigger the override.
    expect(
      recommendFertilityAction({ tryingDurationMonths: 0, ageYears: 22, knownRiskFactors: ["none"] })
    ).toBe("education_only");
  });
});
