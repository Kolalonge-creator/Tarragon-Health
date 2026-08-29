import {
  trendDirection,
  monitoringInterpretationCopy,
  formatAdherencePct,
  isClinicalReviewRecommended,
  readingDueStatus,
} from "./adherence";

describe("trendDirection", () => {
  it("returns unknown with fewer than 4 readings", () => {
    expect(trendDirection([120, 122, 118])).toBe("unknown");
  });

  it("detects a rising trend beyond the noise deadband", () => {
    expect(trendDirection([120, 121, 140, 142])).toBe("up");
  });

  it("detects a falling trend beyond the noise deadband", () => {
    expect(trendDirection([160, 158, 130, 128])).toBe("down");
  });

  it("treats small noise within the deadband as stable", () => {
    expect(trendDirection([120, 121, 119, 120])).toBe("stable");
  });

  it("ignores non-finite values", () => {
    expect(trendDirection([120, NaN, 121, 140, 142])).toBe("up");
  });
});

describe("monitoringInterpretationCopy", () => {
  it("flags a rising trend as concerning when higher is the bad direction", () => {
    expect(monitoringInterpretationCopy("up", true)).toMatch(/higher than your usual range/);
  });

  it("flags a falling trend as concerning when lower is the bad direction (e.g. SpO2)", () => {
    expect(monitoringInterpretationCopy("down", false)).toMatch(/higher than your usual range/);
  });

  it("does not alarm on a favourable direction", () => {
    expect(monitoringInterpretationCopy("down", true)).toMatch(/good direction/);
  });

  it("gives a steady message for a stable trend", () => {
    expect(monitoringInterpretationCopy("stable")).toMatch(/steady/);
  });

  it("gives a not-enough-data message when unknown", () => {
    expect(monitoringInterpretationCopy("unknown")).toMatch(/Keep logging/);
  });
});

describe("formatAdherencePct", () => {
  it("computes a rounded percentage", () => {
    expect(formatAdherencePct(14, 12)).toBeCloseTo(85.7, 1);
  });

  it("caps at 100 even if received exceeds expected", () => {
    expect(formatAdherencePct(10, 15)).toBe(100);
  });

  it("returns null when nothing was expected yet (avoids divide-by-zero)", () => {
    expect(formatAdherencePct(0, 0)).toBeNull();
  });
});

describe("readingDueStatus", () => {
  const now = new Date("2026-08-29T12:00:00Z");

  it("is due today when nothing has ever been logged", () => {
    expect(readingDueStatus(null, 1, now)).toEqual({ label: "Due today", done: false });
  });

  it("is done for today when the last reading was earlier today", () => {
    expect(readingDueStatus("2026-08-29T06:00:00Z", 1, now)).toEqual({ label: "Today", done: true });
  });

  it("shows yesterday when the last reading was one day ago", () => {
    expect(readingDueStatus("2026-08-28T06:00:00Z", 1, now)).toEqual({ label: "Yesterday", done: true });
  });

  it("is still satisfied within a multi-day frequency window", () => {
    expect(readingDueStatus("2026-08-27T06:00:00Z", 7, now)).toEqual({ label: "2 days ago", done: true });
  });

  it("is due again once the frequency window has elapsed", () => {
    expect(readingDueStatus("2026-08-20T06:00:00Z", 7, now)).toEqual({ label: "Due today", done: false });
  });
});

describe("isClinicalReviewRecommended", () => {
  it("flags a worsening trend even with good adherence", () => {
    expect(
      isClinicalReviewRecommended({
        trend: "up",
        consecutiveMisses: 0,
        escalationMissedThreshold: 3,
        adherencePct: 100,
      })
    ).toBe(true);
  });

  it("flags a schedule item that has crossed its own miss threshold", () => {
    expect(
      isClinicalReviewRecommended({
        trend: "stable",
        consecutiveMisses: 3,
        escalationMissedThreshold: 3,
        adherencePct: 100,
      })
    ).toBe(true);
  });

  it("flags materially poor adherence on its own", () => {
    expect(
      isClinicalReviewRecommended({
        trend: "stable",
        consecutiveMisses: 0,
        escalationMissedThreshold: 3,
        adherencePct: 40,
      })
    ).toBe(true);
  });

  it("does not flag a stable, on-schedule, well-adhered episode", () => {
    expect(
      isClinicalReviewRecommended({
        trend: "stable",
        consecutiveMisses: 0,
        escalationMissedThreshold: 3,
        adherencePct: 95,
      })
    ).toBe(false);
  });

  it("respects higherIsConcern=false for a falling trend on e.g. SpO2", () => {
    expect(
      isClinicalReviewRecommended({
        trend: "down",
        higherIsConcern: false,
        consecutiveMisses: 0,
        escalationMissedThreshold: 3,
        adherencePct: 100,
      })
    ).toBe(true);
    expect(
      isClinicalReviewRecommended({
        trend: "up",
        higherIsConcern: false,
        consecutiveMisses: 0,
        escalationMissedThreshold: 3,
        adherencePct: 100,
      })
    ).toBe(false);
  });
});
