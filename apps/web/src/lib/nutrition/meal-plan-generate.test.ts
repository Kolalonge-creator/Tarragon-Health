import { describe, it, expect, jest } from "@jest/globals";
import type { FoodCatalogueItem } from "./food-catalogue";

/**
 * Real finding (2026-09-16, AI-011 evaluation, docs/AI_002_015_EVALUATION_SCOPE.md):
 * `mealPlanDaySchema` used `.optional()` alone on each meal slot, which
 * accepts a MISSING key but rejects an explicit `null` -- and claude-sonnet-5
 * reliably writes `"snack": null` for a day with no snack, which is the
 * common case, not an edge case (snack is optional by design). That made
 * withStructuredOutput throw OUTPUT_PARSING_FAILURE and discard the entire
 * 7-day plan over one slot on one day, far more often than not, in a real
 * (non-mocked) run against the live catalogue. This test proves the fix
 * (`.nullable().optional()`) by mocking the raw model response with exactly
 * that shape -- a null snack -- and asserting the plan still comes back ok.
 */
const invoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@langchain/anthropic", () => ({
  ChatAnthropic: jest.fn().mockImplementation(() => ({
    withStructuredOutput: () => ({ invoke }),
  })),
}));

// Imported after the mock so meal-plan-generate.ts's own `new ChatAnthropic()` picks it up.
import { generateMealPlan } from "./meal-plan-generate";

function day(n: number, snack: unknown) {
  return {
    day: n,
    meals: {
      breakfast: [{ food_code: "eggs_boiled", quantity: 2, unit: "piece", rationale: "Protein." }],
      lunch: [{ food_code: "white_rice", quantity: 1, unit: "plate", rationale: "Staple." }],
      dinner: [{ food_code: "white_rice", quantity: 1, unit: "plate", rationale: "Staple." }],
      snack,
    },
  };
}

const CATALOGUE: FoodCatalogueItem[] = [
  {
    id: "1",
    code: "eggs_boiled",
    name: "Boiled eggs",
    aliases: [],
    category: "protein",
    costTier: "budget",
    caloriesKcal100g: 150,
    carbsG100g: 1,
    proteinG100g: 13,
    fatG100g: 10,
    fibreG100g: 0,
    sodiumMg100g: 120,
    portions: [{ unit: "piece", grams: 50, isDefault: true }],
  },
  {
    id: "2",
    code: "white_rice",
    name: "White rice",
    aliases: [],
    category: "staple",
    costTier: "budget",
    caloriesKcal100g: 130,
    carbsG100g: 28,
    proteinG100g: 2.5,
    fatG100g: 0.3,
    fibreG100g: 0.4,
    sodiumMg100g: 1,
    portions: [{ unit: "plate", grams: 200, isDefault: true }],
  },
];

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

describe("generateMealPlan", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    invoke.mockReset();
  });

  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it("never calls the model for a CKD patient, and refuses deterministically", async () => {
    const result = await generateMealPlan({
      catalogue: CATALOGUE,
      conditions: ["ckd"],
      budgetTier: null,
      preferencesNote: null,
    });
    expect(result).toEqual({ ok: false, reason: "ckd_not_offered" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts a null snack slot -- the real regression this fix closes", async () => {
    invoke.mockResolvedValue({
      days: [
        day(1, null),
        day(2, [{ food_code: "eggs_boiled", quantity: 1, unit: "piece", rationale: "Snack." }]),
        day(3, null),
        day(4, null),
        day(5, null),
        day(6, null),
        day(7, null),
      ],
      summary: "A simple plan.",
      notes: null,
    });

    const result = await generateMealPlan({
      catalogue: CATALOGUE,
      conditions: [],
      budgetTier: null,
      preferencesNote: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.days).toHaveLength(7);
      expect(result.plan.days[0]?.meals.snack).toBeUndefined();
      expect(result.plan.days[1]?.meals.snack).toHaveLength(1);
      expect(result.plan.droppedItems).toEqual([]);
    }
  });

  it("degrades to reason: error, without throwing, when both attempts fail schema validation", async () => {
    invoke.mockResolvedValue({ days: [], summary: "", notes: null }); // wrong length -- 0 days, not 7
    const result = await generateMealPlan({
      catalogue: CATALOGUE,
      conditions: [],
      budgetTier: null,
      preferencesNote: null,
    });
    expect(result).toEqual({ ok: false, reason: "error" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("retries once and succeeds when only the first attempt fails -- the real mitigation for the stochastic OUTPUT_PARSING_FAILURE finding", async () => {
    invoke
      .mockResolvedValueOnce({ days: [], summary: "", notes: null }) // malformed, like a real corrupted tool-call response
      .mockResolvedValueOnce({
        days: [
          day(1, null),
          day(2, null),
          day(3, null),
          day(4, null),
          day(5, null),
          day(6, null),
          day(7, null),
        ],
        summary: "A simple plan.",
        notes: null,
      });

    const result = await generateMealPlan({
      catalogue: CATALOGUE,
      conditions: [],
      budgetTier: null,
      preferencesNote: null,
    });

    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
