import { buildMealVisionSystemPrompt } from "./meal-vision";
import { summariseFoodReference } from "./nigerian-foods";

/**
 * AI-008 prompt contract (S49a). Reading the grounding from the food table must change ONLY the reference line of the prompt: every rule that
 * keeps the estimate honest (coaching only, low confidence when unclear, do not invent foods, non-food returns zeros) is identical in both
 * grounding modes. This is the deterministic half of the AI-008 re-evaluation; the live-model half is scripts/eval-ai008-meal-photo.ts.
 */
const table = Array.from({ length: 30 }, (_, i) => ({
  name: `Table dish ${i}`,
  aliases: [],
  carbsG100g: 20,
  portions: [{ grams: 200, isDefault: true }],
}));

describe("buildMealVisionSystemPrompt", () => {
  const fallback = buildMealVisionSystemPrompt(null).split("\n");
  const grounded = buildMealVisionSystemPrompt(table).split("\n");

  it("has the same number of lines in both modes", () => {
    expect(grounded).toHaveLength(fallback.length);
  });

  it("differs only on the reference line", () => {
    const differing = grounded.map((l, i) => (l === fallback[i] ? null : i)).filter((i): i is number => i !== null);
    expect(differing).toHaveLength(1);
    expect(grounded[differing[0]!]).toContain("Table dish 29");
  });

  it("keeps every safety rule in the grounded prompt", () => {
    const text = grounded.join("\n");
    expect(text).toContain("COACHING GUIDANCE ONLY");
    expect(text).toContain("Set confidence to 'low' when the photo is unclear");
    expect(text).toContain("Do not invent foods you cannot see");
    expect(text).toContain("return an empty items list, zeros, and confidence 'low'");
  });

  it("falls back to the hand-kept reference when the table is not supplied or too small", () => {
    expect(buildMealVisionSystemPrompt(undefined)).toContain(summariseFoodReference());
    expect(buildMealVisionSystemPrompt(table.slice(0, 5))).toContain(summariseFoodReference());
  });
});
