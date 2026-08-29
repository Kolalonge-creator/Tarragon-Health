import { describe, expect, it } from "@jest/globals";
import { estimateDaysRemaining } from "./refill-prediction";

describe("estimateDaysRemaining", () => {
  const today = new Date(2026, 7, 29); // 2026-08-29, matches Date constructor's local-month convention

  it("estimates from quantity and doses/day since the medication started", () => {
    // 30 tablets, 2/day = 15 days supply, started today -> 15 remaining
    expect(
      estimateDaysRemaining({
        quantity: "30",
        scheduleTimes: ["08:00", "20:00"],
        startedOn: "2026-08-29T00:00:00Z",
        today,
      })
    ).toBe(15);
  });

  it("subtracts days already elapsed since the fill date", () => {
    // 30 tablets, 2/day = 15 days supply, filled 10 days ago -> 5 remaining
    expect(
      estimateDaysRemaining({
        quantity: "30 tablets",
        scheduleTimes: ["08:00", "20:00"],
        startedOn: "2026-08-19T00:00:00Z",
        today,
      })
    ).toBe(5);
  });

  it("uses the most recent of started/collected/received as the fill date", () => {
    // Started 30 days ago but collected a fresh 30-day supply 2 days ago.
    expect(
      estimateDaysRemaining({
        quantity: "30",
        scheduleTimes: ["08:00"],
        startedOn: "2026-07-30T00:00:00Z",
        lastCollectedOn: "2026-08-27T00:00:00Z",
        today,
      })
    ).toBe(28);
  });

  it("never goes negative once supply has run out", () => {
    expect(
      estimateDaysRemaining({
        quantity: "10",
        scheduleTimes: ["08:00", "14:00", "20:00"],
        startedOn: "2026-08-01T00:00:00Z",
        today,
      })
    ).toBe(0);
  });

  it("returns null for freeform/as-needed dosing with no schedule", () => {
    expect(
      estimateDaysRemaining({
        quantity: "30",
        scheduleTimes: [],
        startedOn: "2026-08-29T00:00:00Z",
        today,
      })
    ).toBeNull();
  });

  it("returns null when quantity has no parseable number", () => {
    expect(
      estimateDaysRemaining({
        quantity: "as directed",
        scheduleTimes: ["08:00"],
        startedOn: "2026-08-29T00:00:00Z",
        today,
      })
    ).toBeNull();
  });

  it("returns null when quantity is missing", () => {
    expect(
      estimateDaysRemaining({
        quantity: null,
        scheduleTimes: ["08:00"],
        startedOn: "2026-08-29T00:00:00Z",
        today,
      })
    ).toBeNull();
  });
});
