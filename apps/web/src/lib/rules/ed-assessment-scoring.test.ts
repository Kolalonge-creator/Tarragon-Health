import { scoreEdAssessment, IIEF5_ITEM_COUNT } from "./ed-assessment-scoring";

describe("scoreEdAssessment", () => {
  it("bands a perfect score as none, with no cardiometabolic flag", () => {
    const result = scoreEdAssessment([5, 5, 5, 5, 5]);
    expect(result.total).toBe(25);
    expect(result.band).toBe("none");
    expect(result.cardiometabolicReviewSuggested).toBe(false);
  });

  it.each([
    [[5, 4, 4, 4, 4], 21, "mild"],
    [[3, 3, 3, 3, 3], 15, "mild_moderate"],
    [[2, 2, 2, 2, 2], 10, "moderate"],
    [[1, 1, 1, 1, 1], 5, "severe"],
  ] as const)("scores %p as %i / %s", (items, total, band) => {
    const result = scoreEdAssessment([...items]);
    expect(result.total).toBe(total);
    expect(result.band).toBe(band);
    expect(result.cardiometabolicReviewSuggested).toBe(true);
  });

  it("rejects the wrong number of items", () => {
    expect(() => scoreEdAssessment([1, 2, 3])).toThrow(`expects ${IIEF5_ITEM_COUNT} items`);
  });

  it("rejects an out-of-range item", () => {
    expect(() => scoreEdAssessment([0, 2, 3, 4, 5])).toThrow("integers 1–5");
    expect(() => scoreEdAssessment([1, 2, 3, 4, 6])).toThrow("integers 1–5");
  });
});
