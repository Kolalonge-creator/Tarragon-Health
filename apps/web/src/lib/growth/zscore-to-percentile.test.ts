import { describe, expect, it } from "@jest/globals";
import { zScoreToPercentile, formatPercentile } from "./zscore-to-percentile";

describe("zScoreToPercentile", () => {
  it("maps z=0 to the 50th percentile", () => {
    expect(zScoreToPercentile(0)).toBeCloseTo(50, 0);
  });

  it("maps the standard clinical cutoffs correctly", () => {
    expect(zScoreToPercentile(-2)).toBeCloseTo(2.3, 0);
    expect(zScoreToPercentile(2)).toBeCloseTo(97.7, 0);
    expect(zScoreToPercentile(-1)).toBeCloseTo(15.9, 0);
    expect(zScoreToPercentile(1)).toBeCloseTo(84.1, 0);
  });

  it("is symmetric around 50", () => {
    expect(zScoreToPercentile(1.5) + zScoreToPercentile(-1.5)).toBeCloseTo(100, 0);
  });
});

describe("formatPercentile", () => {
  it("adds the correct ordinal suffix", () => {
    expect(formatPercentile(1)).toBe("1st percentile");
    expect(formatPercentile(2)).toBe("2nd percentile");
    expect(formatPercentile(3)).toBe("3rd percentile");
    expect(formatPercentile(4)).toBe("4th percentile");
    expect(formatPercentile(56)).toBe("56th percentile");
  });

  it("uses 'th' for the 11th-13th teens exception", () => {
    expect(formatPercentile(11)).toBe("11th percentile");
    expect(formatPercentile(12)).toBe("12th percentile");
    expect(formatPercentile(13)).toBe("13th percentile");
  });
});
