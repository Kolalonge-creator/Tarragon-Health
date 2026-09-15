import { computeHeartAgeTrend, describeHeartAgeTrend } from "./heart-age";

describe("computeHeartAgeTrend", () => {
  it("returns null with fewer than two real (scored) data points — never fabricates a trend", () => {
    expect(computeHeartAgeTrend([])).toBeNull();
    expect(computeHeartAgeTrend([{ score: 55, computed_at: "2026-01-01" }])).toBeNull();
  });

  it("ignores null-scored rows when deciding whether there are enough real points", () => {
    const history = [
      { score: null, computed_at: "2026-01-01" },
      { score: 55, computed_at: "2026-02-01" },
    ];
    expect(computeHeartAgeTrend(history)).toBeNull();
  });

  it("computes the age delta from the earliest vs latest scored rows", () => {
    const history = [
      { score: 60, computed_at: "2026-01-01" },
      { score: 57, computed_at: "2026-06-01" },
      { score: 55, computed_at: "2026-12-01" },
    ];
    const trend = computeHeartAgeTrend(history)!;
    expect(trend.firstAge).toBe(60);
    expect(trend.lastAge).toBe(55);
    expect(trend.ageDelta).toBe(-5);
    expect(trend.firstDate).toBe("2026-01-01");
    expect(trend.lastDate).toBe("2026-12-01");
  });
});

describe("describeHeartAgeTrend", () => {
  it("credits a falling heart age as real progress, no fear-based framing either direction", () => {
    const line = describeHeartAgeTrend({
      firstAge: 60,
      lastAge: 55,
      firstDate: "2026-01-01",
      lastDate: "2026-12-01",
      ageDelta: -5,
    });
    expect(line).toContain("60 to 55");
    expect(line).toContain("progress");
  });

  it("describes a rising heart age gently, with no alarming language", () => {
    const line = describeHeartAgeTrend({
      firstAge: 55,
      lastAge: 60,
      firstDate: "2026-01-01",
      lastDate: "2026-12-01",
      ageDelta: 5,
    });
    expect(line).toContain("55 to 60");
    expect(line).not.toMatch(/warning|alarm|danger/i);
  });

  it("describes an unchanged heart age as steady", () => {
    const line = describeHeartAgeTrend({
      firstAge: 58,
      lastAge: 58,
      firstDate: "2026-01-01",
      lastDate: "2026-12-01",
      ageDelta: 0,
    });
    expect(line).toContain("steady at 58");
  });
});
