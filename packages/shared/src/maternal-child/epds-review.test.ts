import { describe, expect, it } from "@jest/globals";
import { currentEpdsCutoffs, reviewEpds } from "./epds-review";

const answers = (total: number, item10 = 0): number[] => {
  const a = Array<number>(10).fill(0);
  let left = total - item10;
  for (let i = 0; i < 9 && left > 0; i++) { const v = Math.min(3, left); a[i] = v; left -= v; }
  a[9] = item10;
  return a;
};

describe("EPDS routing (CMO pack A6, proposed)", () => {
  it("reads the cut-offs from versioned configuration, not from code", () => {
    const { cutoffs, version } = currentEpdsCutoffs();
    expect(version).toBe(1);
    expect(cutoffs.possible_min).toBe(10);
    expect(cutoffs.probable_min).toBe(13);
  });

  it("9 or less asks for nothing", () => {
    expect(reviewEpds(answers(9)).band).toBe("none");
    expect(reviewEpds(answers(9)).reviewDueInHours).toBeNull();
  });

  it("10 to 12 is 'possible': a review within the week (168 hours)", () => {
    for (const t of [10, 11, 12]) {
      const r = reviewEpds(answers(t));
      expect([t, r.band, r.reviewDueInHours]).toEqual([t, "possible", 168]);
    }
  });

  it("13 or more is 'probable': a review within 48 hours", () => {
    for (const t of [13, 20, 27]) {
      const r = reviewEpds(answers(t));
      expect([t, r.band, r.reviewDueInHours]).toEqual([t, "probable", 48]);
    }
  });

  it("ANY non-zero item 10 is a crisis whatever the total: item 10 beats a low total", () => {
    const low = reviewEpds(answers(3, 1));
    expect(low.total).toBe(3);
    expect(low.band).toBe("crisis");
    expect(low.crisis).toBe(true);
    expect(low.reviewDueInHours).toBe(0);
    expect(reviewEpds(answers(1, 1)).crisis).toBe(true);
  });

  it("item 10 also beats a high total (the crisis route is not the 48 hour route)", () => {
    expect(reviewEpds(answers(25, 3)).band).toBe("crisis");
  });

  it("item 10 of zero with a high total is not a crisis", () => {
    expect(reviewEpds(answers(20, 0)).crisis).toBe(false);
  });

  it("refuses a wrong number of answers or an answer outside 0 to 3", () => {
    expect(() => reviewEpds([1, 2, 3])).toThrow();
    expect(() => reviewEpds([0, 0, 0, 0, 0, 0, 0, 0, 0, 4])).toThrow();
    expect(() => reviewEpds([0, 0, 0, 0, 0, 0, 0, 0, 0, 1.5])).toThrow();
  });

  it("the crisis rule can be switched off only by configuration (a second source)", () => {
    const src = currentEpdsCutoffs();
    const off = reviewEpds(answers(3, 1), { ...src, cutoffs: { ...src.cutoffs, item_10_any_nonzero_is_crisis: false } });
    expect(off.crisis).toBe(false);
  });
});
