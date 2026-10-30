import { describe, expect, it } from "@jest/globals";
import { classifyReliableChange, reliableChangePoints, summariseReliableChange } from "./reliable-change";

describe("classifyReliableChange (D4)", () => {
  it("a fall of exactly the points is a reliable improvement, one point less is not", () => {
    expect(classifyReliableChange(14, 8, 6)).toBe("reliable_improvement");
    expect(classifyReliableChange(14, 9, 6)).toBe("no_reliable_change");
  });
  it("a rise of exactly the points is a reliable deterioration, one point less is not", () => {
    expect(classifyReliableChange(8, 14, 6)).toBe("reliable_deterioration");
    expect(classifyReliableChange(8, 13, 6)).toBe("no_reliable_change");
  });
  it("no change at all is no reliable change", () => {
    expect(classifyReliableChange(10, 10, 4)).toBe("no_reliable_change");
  });
  it("a missing score, a missing baseline or an unusable points value is insufficient data, never not improved", () => {
    expect(classifyReliableChange(10, null, 4)).toBe("insufficient_data");
    expect(classifyReliableChange(null, 4, 4)).toBe("insufficient_data");
    expect(classifyReliableChange(undefined, undefined, 4)).toBe("insufficient_data");
    expect(classifyReliableChange(10, 4, null)).toBe("insufficient_data");
    expect(classifyReliableChange(10, 4, 0)).toBe("insufficient_data");
    expect(classifyReliableChange(10, 4, 4.5)).toBe("insufficient_data");
    expect(classifyReliableChange(10.5, 4, 4)).toBe("insufficient_data");
  });
  it("a baseline lower than the points cannot show a reliable improvement", () => {
    expect(classifyReliableChange(5, 0, 6)).toBe("no_reliable_change");
  });
});

describe("summariseReliableChange", () => {
  it("partitions the group: the four counts add up to n", () => {
    const c = summariseReliableChange(
      [
        { baseline: 14, score: 6 },
        { baseline: 14, score: 12 },
        { baseline: 9, score: 16 },
        { baseline: 12, score: null },
        { baseline: 11, score: 4 },
      ],
      6,
    );
    expect(c).toEqual({ reliable_improvement: 2, no_reliable_change: 1, reliable_deterioration: 1, insufficient_data: 1, n: 5 });
    expect(c.reliable_improvement + c.no_reliable_change + c.reliable_deterioration + c.insufficient_data).toBe(c.n);
  });
  it("with no usable points everything is insufficient data", () => {
    expect(summariseReliableChange([{ baseline: 14, score: 2 }], null)).toEqual({ reliable_improvement: 0, no_reliable_change: 0, reliable_deterioration: 0, insufficient_data: 1, n: 1 });
  });
});

describe("reliableChangePoints", () => {
  it("reads a usable value and refuses anything else", () => {
    const ok = { instruments: { phq9: { reliable_change_points: 6 }, gad7: { reliable_change_points: 4 } } };
    expect(reliableChangePoints(ok, "phq9")).toBe(6);
    expect(reliableChangePoints(ok, "gad7")).toBe(4);
    expect(reliableChangePoints(null, "phq9")).toBeNull();
    expect(reliableChangePoints({}, "phq9")).toBeNull();
    expect(reliableChangePoints({ instruments: { phq9: { reliable_change_points: 0 } } }, "phq9")).toBeNull();
    expect(reliableChangePoints({ instruments: { phq9: { reliable_change_points: "6" } } }, "phq9")).toBeNull();
  });
});
