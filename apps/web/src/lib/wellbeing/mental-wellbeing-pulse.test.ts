import {
  scoreWellbeingPulse,
  WELLBEING_QUESTION_COUNT,
  WELLBEING_QUESTIONS,
} from "./mental-wellbeing-pulse";

describe("scoreWellbeingPulse", () => {
  it("has exactly ten questions", () => {
    expect(WELLBEING_QUESTIONS).toHaveLength(WELLBEING_QUESTION_COUNT);
  });

  it("bands the lowest possible score as struggling", () => {
    const result = scoreWellbeingPulse(new Array(10).fill(1));
    expect(result.total).toBe(10);
    expect(result.band).toBe("struggling");
  });

  it("bands the highest possible score as thriving", () => {
    const result = scoreWellbeingPulse(new Array(10).fill(5));
    expect(result.total).toBe(50);
    expect(result.band).toBe("thriving");
  });

  it("bands a mid-range score as steady, not struggling", () => {
    const result = scoreWellbeingPulse(new Array(10).fill(3));
    expect(result.total).toBe(30);
    expect(result.band).toBe("under_strain");
  });

  it("is monotonic: a strictly higher total never lands in a lower band", () => {
    const bandOrder = ["struggling", "under_strain", "steady", "thriving"];
    let previousIndex = -1;
    for (let total = 10; total <= 50; total++) {
      // Build an answer set summing to `total` using values 1-5 across 10 items.
      const answers = new Array(10).fill(1);
      let remaining = total - 10;
      for (let i = 0; i < answers.length && remaining > 0; i++) {
        const add = Math.min(4, remaining);
        answers[i] += add;
        remaining -= add;
      }
      const { band } = scoreWellbeingPulse(answers);
      const index = bandOrder.indexOf(band);
      expect(index).toBeGreaterThanOrEqual(previousIndex);
      previousIndex = index;
    }
  });

  it("rejects the wrong number of answers", () => {
    expect(() => scoreWellbeingPulse([3, 3, 3])).toThrow();
  });

  it("rejects out-of-range or non-integer answers", () => {
    expect(() => scoreWellbeingPulse(new Array(10).fill(0))).toThrow();
    expect(() => scoreWellbeingPulse(new Array(10).fill(6))).toThrow();
    expect(() => scoreWellbeingPulse([1.5, ...new Array(9).fill(3)])).toThrow();
  });
});
