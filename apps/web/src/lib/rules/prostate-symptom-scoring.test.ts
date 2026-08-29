import {
  scoreProstateSymptoms,
  psaConversationSuggested,
  IPSS_ITEM_COUNT,
} from "./prostate-symptom-scoring";

describe("scoreProstateSymptoms", () => {
  it("bands a symptom-free score as mild", () => {
    expect(scoreProstateSymptoms([0, 0, 0, 0, 0, 0, 0])).toEqual({ total: 0, band: "mild" });
  });

  it.each([
    [[1, 1, 1, 1, 1, 1, 1], 7, "mild"],
    [[2, 2, 2, 2, 2, 2, 2], 14, "moderate"],
    [[5, 5, 5, 5, 5, 5, 5], 35, "severe"],
  ] as const)("scores %p as %i / %s", (items, total, band) => {
    expect(scoreProstateSymptoms([...items])).toEqual({ total, band });
  });

  it("rejects the wrong number of items", () => {
    expect(() => scoreProstateSymptoms([1, 2, 3])).toThrow(`expects ${IPSS_ITEM_COUNT} items`);
  });

  it("rejects an out-of-range item", () => {
    expect(() => scoreProstateSymptoms([0, 0, 0, 0, 0, 0, 6])).toThrow("integers 0–5");
  });
});

describe("psaConversationSuggested", () => {
  it("is false with an unknown age", () => {
    expect(psaConversationSuggested(null, true)).toBe(false);
  });

  it("is false under 45 regardless of family history", () => {
    expect(psaConversationSuggested(40, true)).toBe(false);
  });

  it("is true from 45 only with family history", () => {
    expect(psaConversationSuggested(46, true)).toBe(true);
    expect(psaConversationSuggested(46, false)).toBe(false);
  });

  it("is true from 50 regardless of family history", () => {
    expect(psaConversationSuggested(51, false)).toBe(true);
  });
});
