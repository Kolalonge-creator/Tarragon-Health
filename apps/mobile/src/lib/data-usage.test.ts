import { addDataUsage, formatBytes, getMonthlyDataUsage, monthKey } from "./data-usage";

describe("data-use meter", () => {
  it("adds up what the sync code reports, per month", async () => {
    const oct = new Date("2026-10-13T10:00:00Z");
    await addDataUsage(1200, oct);
    await addDataUsage(800, oct);
    await addDataUsage(500, new Date("2026-11-01T10:00:00Z"));
    expect(await getMonthlyDataUsage(oct)).toBe(2000);
    expect(await getMonthlyDataUsage(new Date("2026-11-20T00:00:00Z"))).toBe(500);
    expect(monthKey(oct)).toBe("@tarragon/data-usage/2026-10");
  });

  it("does not lose counts when syncs report at the same time", async () => {
    const now = new Date("2026-10-13T10:00:00Z");
    await Promise.all(Array.from({ length: 20 }, () => addDataUsage(100, now)));
    expect(await getMonthlyDataUsage(now)).toBe(2000);
  });

  it("ignores zero, negative and non-numbers", async () => {
    const now = new Date("2026-10-13T10:00:00Z");
    await addDataUsage(0, now);
    await addDataUsage(-5, now);
    await addDataUsage(Number.NaN, now);
    expect(await getMonthlyDataUsage(now)).toBe(0);
  });

  it("formats for a patient", () => {
    expect(formatBytes(340_000)).toBe("340 KB");
    expect(formatBytes(1_250_000)).toBe("1.3 MB");
    expect(formatBytes(0)).toBe("0 KB");
  });
});
