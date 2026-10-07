import { describe, expect, it } from "@jest/globals";
import { classifyNutrition, currentNutritionRules, nutritionCopyKey, type NutritionInput } from "./nutrition";

const row = (over: Partial<NutritionInput>): NutritionInput => ({ ageDays: 400, muacMm: null, weightForHeightZ: null, oedema: false, ...over });

// the same table the SQL proof checks (packages/db/tests/s68_who_growth_and_nutrition_routing.sql, section 4)
describe("nutrition routing parity with private.classify_nutrition", () => {
  it.each([
    [row({ muacMm: 110 }), "severe_acute"],
    [row({ muacMm: 114.9 }), "severe_acute"],
    [row({ muacMm: 115 }), "moderate_acute"],
    [row({ muacMm: 120 }), "moderate_acute"],
    [row({ muacMm: 124.9 }), "moderate_acute"],
    [row({ muacMm: 125 }), "none"],
    [row({ weightForHeightZ: -3.01 }), "severe_acute"],
    [row({ weightForHeightZ: -3.0 }), "moderate_acute"],
    [row({ weightForHeightZ: -2.01 }), "moderate_acute"],
    [row({ weightForHeightZ: -2.0 }), "none"],
    [row({ muacMm: 140, weightForHeightZ: 0, oedema: true }), "severe_acute"],
    [row({ ageDays: 150, muacMm: 100, weightForHeightZ: 0 }), "none"],
    [row({ ageDays: 1900, muacMm: 100 }), "none"],
    [row({ ageDays: 150, weightForHeightZ: -3.5 }), "severe_acute"],
  ] as [NutritionInput, string][])("%j is %s", (input, expected) => {
    expect(classifyNutrition(input)).toBe(expected);
  });

  it("takes every number from versioned configuration", () => {
    const { rules, version } = currentNutritionRules();
    expect(version).toBe(1);
    expect(rules.sam_muac_mm_lt).toBe(115);
    expect(classifyNutrition(row({ muacMm: 118 }), { ...rules, sam_muac_mm_lt: 120 })).toBe("severe_acute");
  });
});

describe("what the screen says", () => {
  it("says nothing for none, says follow-up is not switched on when the guard is closed, never claims more", () => {
    expect(nutritionCopyKey("none", true)).toBeNull();
    expect(nutritionCopyKey(null, true)).toBeNull();
    expect(nutritionCopyKey("severe_acute", false)).toBe("mch.growth.not_followed_up");
    expect(nutritionCopyKey("severe_acute", true)).toBe("mch.growth.nutrition_severe");
    expect(nutritionCopyKey("moderate_acute", true)).toBe("mch.growth.nutrition_moderate");
  });
});
