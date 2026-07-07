import { describe, expect, it } from "@jest/globals";
import { startOfLagosDayUtc } from "./lagos-day";

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
