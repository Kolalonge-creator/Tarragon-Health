import {
  FX_REVIEW_INTERVAL_DAYS,
  FX_REVIEW_OVERDUE_DAYS,
  daysSince,
  fxReviewMessage,
  fxReviewStatus,
} from "./fx-review";

const NOW = new Date("2026-07-31T12:00:00.000Z");

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("daysSince", () => {
  it("returns null when there is no timestamp at all", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince(undefined, NOW)).toBeNull();
  });

  it("returns null rather than NaN for an unparseable timestamp", () => {
    expect(daysSince("not a date", NOW)).toBeNull();
  });

  it("counts whole elapsed days", () => {
    expect(daysSince(isoDaysAgo(0), NOW)).toBe(0);
    expect(daysSince(isoDaysAgo(1), NOW)).toBe(1);
    expect(daysSince(isoDaysAgo(45), NOW)).toBe(45);
  });

  it("floors a partial day rather than rounding it up", () => {
    // 30 days and 23 hours is still 30 days, never 31. A review must never
    // read as staler than it actually is.
    const almostThirtyOne = new Date(NOW.getTime() - (30 * 86_400_000 + 23 * 3_600_000));
    expect(daysSince(almostThirtyOne.toISOString(), NOW)).toBe(30);
  });

  it("clamps a future timestamp to zero instead of going negative", () => {
    expect(daysSince(isoDaysAgo(-5), NOW)).toBe(0);
  });
});

describe("fxReviewStatus", () => {
  it("flags a rate no person has ever reviewed", () => {
    expect(fxReviewStatus(null)).toBe("never");
  });

  it("is current right up to the review interval", () => {
    expect(fxReviewStatus(0)).toBe("current");
    expect(fxReviewStatus(FX_REVIEW_INTERVAL_DAYS - 1)).toBe("current");
  });

  it("becomes due on the interval boundary, not after it", () => {
    expect(fxReviewStatus(FX_REVIEW_INTERVAL_DAYS)).toBe("due");
  });

  it("escalates to overdue on the overdue boundary", () => {
    expect(fxReviewStatus(FX_REVIEW_OVERDUE_DAYS - 1)).toBe("due");
    expect(fxReviewStatus(FX_REVIEW_OVERDUE_DAYS)).toBe("overdue");
    expect(fxReviewStatus(400)).toBe("overdue");
  });
});

describe("fxReviewMessage", () => {
  it("says plainly that nobody has ever reviewed it", () => {
    expect(fxReviewMessage(null)).toContain("never been reviewed");
  });

  it("reads naturally for today and for a single day", () => {
    expect(fxReviewMessage(0)).toBe("Reviewed today.");
    expect(fxReviewMessage(1)).toBe("Reviewed 1 day ago.");
    expect(fxReviewMessage(2)).toBe("Reviewed 2 days ago.");
  });

  it("reassures that confirming changes no price", () => {
    expect(fxReviewMessage(FX_REVIEW_INTERVAL_DAYS)).toContain("changes no price");
  });

  it("names the real elapsed time when overdue", () => {
    expect(fxReviewMessage(120)).toContain("120 days ago");
  });
});
