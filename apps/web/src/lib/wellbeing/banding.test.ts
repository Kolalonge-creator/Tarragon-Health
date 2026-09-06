import { bandHigherIsBetter, bandLowerIsBetter, wellbeingBandLabel } from "./banding";

describe("bandHigherIsBetter", () => {
  it("bands a 1-5 scale where higher is better", () => {
    expect(bandHigherIsBetter(1)).toBe("attention");
    expect(bandHigherIsBetter(2)).toBe("attention");
    expect(bandHigherIsBetter(3)).toBe("moderate");
    expect(bandHigherIsBetter(4)).toBe("stable");
    expect(bandHigherIsBetter(5)).toBe("stable");
  });
});

describe("bandLowerIsBetter", () => {
  it("bands a 1-5 scale where lower is better", () => {
    expect(bandLowerIsBetter(1)).toBe("stable");
    expect(bandLowerIsBetter(2)).toBe("stable");
    expect(bandLowerIsBetter(3)).toBe("moderate");
    expect(bandLowerIsBetter(4)).toBe("attention");
    expect(bandLowerIsBetter(5)).toBe("attention");
  });
});

describe("wellbeingBandLabel", () => {
  it("labels every band", () => {
    expect(wellbeingBandLabel("attention")).toBe("Needs attention");
    expect(wellbeingBandLabel("moderate")).toBe("Moderate");
    expect(wellbeingBandLabel("stable")).toBe("Stable");
  });
});
