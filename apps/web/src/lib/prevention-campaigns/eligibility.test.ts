import { describe, expect, it } from "@jest/globals";
import { buildCampaignEligibilityContext, isEligibleForCampaign } from "./eligibility";

describe("campaign eligibility", () => {
  it("builds a context keyed by <condition>_tier from the patient's own latest scores", () => {
    const context = buildCampaignEligibilityContext(
      { sex: "female", ageYears: 45 },
      new Map([["hypertension", "high"], ["diabetes", "low"]]),
    );
    expect(context).toEqual({
      sex: "female",
      ageYears: 45,
      hypertension_tier: "high",
      diabetes_tier: "low",
    });
  });

  it("evaluates a campaign rule against that context", () => {
    const context = buildCampaignEligibilityContext(
      { sex: "male", ageYears: 50 },
      new Map([["hypertension", "moderate"]]),
    );
    expect(
      isEligibleForCampaign({ op: "in", field: "hypertension_tier", value: ["moderate", "high"] }, context),
    ).toBe(true);
    expect(isEligibleForCampaign({ op: "eq", field: "hypertension_tier", value: "high" }, context)).toBe(
      false,
    );
  });

  it("a campaign a patient has no score for never matches a tier-based rule", () => {
    const context = buildCampaignEligibilityContext({ sex: "female", ageYears: 30 }, new Map());
    expect(isEligibleForCampaign({ op: "eq", field: "diabetes_tier", value: "high" }, context)).toBe(false);
  });
});
