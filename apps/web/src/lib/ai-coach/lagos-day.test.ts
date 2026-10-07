import { describe, expect, it } from "@jest/globals";
import { startOfLagosDayUtc, startOfLagosMonthUtc } from "./lagos-day";

describe("startOfLagosDayUtc", () => {
  it("returns 23:00 UTC the previous day (00:00 Lagos = 23:00 UTC-1day)", () => {
    // 10:30 UTC on 7 Jul 2026 is 11:30 Lagos time, same Lagos calendar day.
    const result = startOfLagosDayUtc(new Date("2026-07-07T10:30:00.000Z"));
    expect(result.toISOString()).toBe("2026-07-06T23:00:00.000Z");
  });

  it("rolls over just after Lagos midnight", () => {
    // 23:05 UTC on 6 Jul is 00:05 Lagos on 7 Jul — already the next Lagos day.
    const result = startOfLagosDayUtc(new Date("2026-07-06T23:05:00.000Z"));
    expect(result.toISOString()).toBe("2026-07-06T23:00:00.000Z");
  });

  it("stays on the same side just before Lagos midnight", () => {
    // 22:55 UTC on 6 Jul is 23:55 Lagos, still the 6th in Lagos.
    const result = startOfLagosDayUtc(new Date("2026-07-06T22:55:00.000Z"));
    expect(result.toISOString()).toBe("2026-07-05T23:00:00.000Z");
  });
});

describe("startOfLagosMonthUtc", () => {
  it("returns 23:00 UTC on the last day of the prior month (00:00 Lagos on the 1st = 23:00 UTC the 30th/31st)", () => {
    const result = startOfLagosMonthUtc(new Date("2026-07-15T10:30:00.000Z"), 0);
    expect(result.toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });

  it("rolls a job earned just after Lagos midnight on the 1st into the new month", () => {
    // 23:05 UTC on 30 Jun is 00:05 Lagos on 1 Jul — already July in Lagos,
    // the exact boundary the naive Date.UTC(y, m, 1) version misclassified.
    const now = new Date("2026-06-30T23:05:00.000Z");
    const startOfThisMonth = startOfLagosMonthUtc(now, 0);
    expect(startOfThisMonth.toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(now.getTime()).toBeGreaterThanOrEqual(startOfThisMonth.getTime());
  });

  it("supports a negative offset to reach the prior month's boundary", () => {
    const result = startOfLagosMonthUtc(new Date("2026-07-15T10:30:00.000Z"), -1);
    expect(result.toISOString()).toBe("2026-05-31T23:00:00.000Z");
  });

  it("handles a year rollover", () => {
    const result = startOfLagosMonthUtc(new Date("2026-01-15T10:30:00.000Z"), -1);
    expect(result.toISOString()).toBe("2025-11-30T23:00:00.000Z");
  });
});
