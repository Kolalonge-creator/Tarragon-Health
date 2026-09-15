import { getConditionNutritionGuidance } from "./condition-guidance";
import type { NutritionAnalysisResult } from "./nutrition-analysis";

function analysis(overrides: Partial<NutritionAnalysisResult>): NutritionAnalysisResult {
  return {
    caloriesKcal: 300,
    carbsG: 30,
    proteinG: 10,
    fatG: 10,
    fibreG: 5,
    sodiumMg: 200,
    reliable: true,
    matchedCount: 2,
    unmatchedCount: 0,
    ...overrides,
  };
}

describe("getConditionNutritionGuidance", () => {
  it("gives a general balanced-plate message when no chronic condition applies", () => {
    const messages = getConditionNutritionGuidance([], null);
    expect(messages).toHaveLength(1);
    expect(messages[0].condition).toBe("general");
  });

  it("gives hypertension a sodium-watch message when the meal is high in sodium", () => {
    const messages = getConditionNutritionGuidance(["hypertension"], analysis({ sodiumMg: 900 }));
    const htn = messages.find((m) => m.condition === "hypertension");
    expect(htn?.tone).toBe("watch");
    expect(htn?.message.toLowerCase()).toContain("sodium");
  });

  it("gives hypertension an encouraging pattern message when sodium is unremarkable", () => {
    const messages = getConditionNutritionGuidance(["hypertension"], analysis({ sodiumMg: 200 }));
    const htn = messages.find((m) => m.condition === "hypertension");
    expect(htn?.tone).toBe("encourage");
  });

  it("gives diabetes a carb-watch message for a carb-heavy meal, never 'don't eat'", () => {
    const messages = getConditionNutritionGuidance(["diabetes"], analysis({ carbsG: 120 }));
    const dm = messages.find((m) => m.condition === "diabetes");
    expect(dm?.tone).toBe("watch");
    expect(dm?.message.toLowerCase()).not.toContain("don't eat");
    expect(dm?.message.toLowerCase()).toContain("portion");
  });

  it("never gives CKD a numeric restriction, only a dietitian-referral nudge", () => {
    const messages = getConditionNutritionGuidance(["ckd"], analysis({ sodiumMg: 5000, carbsG: 500 }));
    const ckd = messages.find((m) => m.condition === "ckd");
    expect(ckd?.message).toMatch(/dietitian/i);
    expect(ckd?.message).not.toMatch(/\d+\s*(mg|g)\b/i);
  });

  it("stacks guidance for multiple co-occurring conditions", () => {
    const messages = getConditionNutritionGuidance(
      ["hypertension", "diabetes"],
      analysis({ sodiumMg: 900, carbsG: 120 }),
    );
    expect(messages.map((m) => m.condition).sort()).toEqual(["diabetes", "hypertension"]);
  });
});
