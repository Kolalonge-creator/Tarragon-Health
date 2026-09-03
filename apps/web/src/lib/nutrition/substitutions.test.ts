import { pickDominantContributor, suggestBudgetAlternative, suggestSubstitution } from "./substitutions";
import { parseFoodText } from "./food-parser";
import { FIXTURE_CATALOGUE } from "./test-fixtures";

describe("suggestSubstitution", () => {
  it("never says 'don't eat' — always frames a portion-first suggestion", () => {
    const result = suggestSubstitution({
      foodCode: "jollof_rice",
      concern: "sodium",
      catalogue: FIXTURE_CATALOGUE,
    });
    expect(result?.message.toLowerCase()).not.toContain("don't eat");
    expect(result?.message.toLowerCase()).toContain("smaller portion");
  });

  it("suggests a lower-sodium same-category alternative when one exists", () => {
    const result = suggestSubstitution({
      foodCode: "jollof_rice", // 320mg sodium/100g
      concern: "sodium",
      catalogue: FIXTURE_CATALOGUE,
    });
    expect(result?.alternativeFoodCodes).toContain("white_rice"); // 1mg sodium/100g, same category
  });

  it("returns no alternatives (but still a portion suggestion) when nothing in-category is lower", () => {
    const result = suggestSubstitution({
      foodCode: "white_rice", // already the lowest-sodium staple in the fixture set
      concern: "sodium",
      catalogue: FIXTURE_CATALOGUE,
    });
    expect(result?.alternativeFoodCodes).toEqual([]);
    expect(result?.message).toContain("smaller portion");
  });

  it("filters alternatives to the budget tier when budget-constrained", () => {
    const result = suggestSubstitution({
      foodCode: "moi_moi", // mid-tier legume
      concern: "general",
      budgetConstrained: true,
      catalogue: FIXTURE_CATALOGUE,
    });
    const alt = FIXTURE_CATALOGUE.find((f) => f.code === result?.alternativeFoodCodes[0]);
    expect(alt?.costTier).toBe("budget");
  });

  it("returns null for an unknown food code", () => {
    expect(
      suggestSubstitution({ foodCode: "not_a_real_food", concern: "general", catalogue: FIXTURE_CATALOGUE }),
    ).toBeNull();
  });
});

describe("suggestBudgetAlternative", () => {
  it("recognises a catalogue food directly (e.g. an expensive protein)", () => {
    const result = suggestBudgetAlternative("stockfish", FIXTURE_CATALOGUE);
    expect(result).not.toBeNull();
    expect(result?.message).toContain("budget-friendly");
  });

  it("handles the spec's own example — an imported food not in the local catalogue", () => {
    const result = suggestBudgetAlternative("I cannot afford salmon", FIXTURE_CATALOGUE);
    expect(result).not.toBeNull();
    const alt = FIXTURE_CATALOGUE.find((f) => f.code === result?.alternativeFoodCodes[0]);
    expect(alt?.category).toBe("protein");
    expect(alt?.costTier).toBe("budget");
  });

  it("returns null when the food is neither in the catalogue nor a known foreign-food hint", () => {
    expect(suggestBudgetAlternative("some completely unrecognisable dish", FIXTURE_CATALOGUE)).toBeNull();
  });
});

describe("pickDominantContributor", () => {
  it("picks the item contributing the most sodium, not just the first one", () => {
    // ewedu soup (250mg/100g @ 250g default = 625mg) vs stockfish (1200mg/100g
    // @ 30g default piece = 360mg) — ewedu should win here despite the lower
    // per-100g figure, because the realistic portion size dominates.
    const items = parseFoodText("stockfish and ewedu soup", FIXTURE_CATALOGUE);
    expect(pickDominantContributor(items, FIXTURE_CATALOGUE, "sodium")).toBe("ewedu_soup");
  });

  it("picks the item contributing the most carbs", () => {
    const items = parseFoodText("rice and beans", FIXTURE_CATALOGUE);
    expect(pickDominantContributor(items, FIXTURE_CATALOGUE, "carbs")).toBe("white_rice");
  });

  it("ignores unmatched items", () => {
    const items = parseFoodText("some unknown alien food", FIXTURE_CATALOGUE);
    expect(pickDominantContributor(items, FIXTURE_CATALOGUE, "sodium")).toBeNull();
  });
});
