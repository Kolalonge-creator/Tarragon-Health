import { detectNutritionRisk } from "./referral-risk";
import type { NutritionAnalysisResult } from "./nutrition-analysis";

function reading(overrides: Partial<NutritionAnalysisResult>): NutritionAnalysisResult {
  return {
    caloriesKcal: 300,
    carbsG: 30,
    proteinG: 10,
    fatG: 10,
    fibreG: 8,
    sodiumMg: 200,
    reliable: true,
    matchedCount: 2,
    unmatchedCount: 0,
    ...overrides,
  };
}

describe("detectNutritionRisk", () => {
  it("is never at risk with no chronic conditions and unremarkable logs", () => {
    const result = detectNutritionRisk([], [reading({}), reading({})]);
    expect(result.atRisk).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("always flags CKD, regardless of logged meals", () => {
    const result = detectNutritionRisk(["ckd"], []);
    expect(result.atRisk).toBe(true);
    expect(result.reasons).toContain("ckd_condition_needs_specialist_input");
  });

  it("flags a sustained high-sodium pattern for hypertension after 3+ high-sodium meals", () => {
    const logs = [reading({ sodiumMg: 900 }), reading({ sodiumMg: 950 }), reading({ sodiumMg: 1000 })];
    const result = detectNutritionRisk(["hypertension"], logs);
    expect(result.reasons).toContain("sustained_high_sodium_pattern");
  });

  it("does not flag a pattern from only 1-2 high-sodium meals", () => {
    const logs = [reading({ sodiumMg: 900 }), reading({ sodiumMg: 200 }), reading({ sodiumMg: 200 })];
    const result = detectNutritionRisk(["hypertension"], logs);
    expect(result.reasons).not.toContain("sustained_high_sodium_pattern");
  });

  it("ignores unreliable (partially-matched) logs when checking for a pattern", () => {
    const logs = [
      reading({ sodiumMg: 900, reliable: false }),
      reading({ sodiumMg: 900, reliable: false }),
      reading({ sodiumMg: 900, reliable: false }),
    ];
    const result = detectNutritionRisk(["hypertension"], logs);
    expect(result.reasons).not.toContain("sustained_high_sodium_pattern");
  });

  it("flags a sustained high-carb, low-fibre pattern for diabetes", () => {
    const logs = [
      reading({ carbsG: 100, fibreG: 2 }),
      reading({ carbsG: 100, fibreG: 2 }),
      reading({ carbsG: 100, fibreG: 2 }),
    ];
    const result = detectNutritionRisk(["diabetes"], logs);
    expect(result.reasons).toContain("sustained_high_carb_low_fibre_pattern");
  });

  it("only looks at the most recent handful of logs, not the whole history", () => {
    // 5 recent normal-sodium meals (within the lookback window), then a long
    // tail of older high-sodium meals that should no longer count.
    const recentNormal = Array.from({ length: 5 }, () => reading({ sodiumMg: 200 }));
    const oldHighSodium = Array.from({ length: 10 }, () => reading({ sodiumMg: 900 }));
    const result = detectNutritionRisk(["hypertension"], [...recentNormal, ...oldHighSodium]);
    expect(result.reasons).not.toContain("sustained_high_sodium_pattern");
  });
});
