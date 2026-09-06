import { drinksThisWeek } from "./alcohol";
import type { AlcoholConsumptionLog } from "./alcohol";

function log(logged_on: string, drinks_count: number): AlcoholConsumptionLog {
  return {
    id: logged_on,
    organisation_id: "org",
    patient_id: "patient",
    logged_on,
    drinks_count,
    context: null,
    created_at: `${logged_on}T00:00:00Z`,
  };
}

describe("drinksThisWeek", () => {
  beforeEach(() => {
    // Freeze "now" so the trailing-7-day window is deterministic.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-28T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("sums drinks within the trailing 7 days inclusive of today", () => {
    const rows = [log("2026-08-22", 2), log("2026-08-25", 1), log("2026-08-28", 3)];
    expect(drinksThisWeek(rows)).toBe(6);
  });

  it("excludes entries older than 7 days back", () => {
    const rows = [log("2026-08-20", 5), log("2026-08-27", 1)];
    expect(drinksThisWeek(rows)).toBe(1);
  });

  it("returns 0 for an empty log", () => {
    expect(drinksThisWeek([])).toBe(0);
  });
});
