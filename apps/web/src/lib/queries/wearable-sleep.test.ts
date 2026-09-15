import { describe, expect, it } from "@jest/globals";
import { summarise } from "./wearable-sleep";

/** Each value is one night's sleep_minutes, most recent first — matching the
 * `recorded_at desc` order the query hook fetches in. */

describe("sleep summary (53.8)", () => {
  it("reports nothing when no nights have synced", () => {
    const summary = summarise([]);
    expect(summary.lastNightMinutes).toBeNull();
    expect(summary.averageMinutes).toBeNull();
    expect(summary.nightsInWindow).toBe(0);
    expect(summary.consistency).toBe("unknown");
    expect(summary.trend).toBe("unknown");
  });

  it("uses the most recent value as last night, and averages across whatever nights are present", () => {
    const summary = summarise([420, 400, 440]);
    expect(summary.lastNightMinutes).toBe(420);
    expect(summary.averageMinutes).toBe(420);
    expect(summary.nightsInWindow).toBe(3);
  });

  it("does not claim a consistency verdict from fewer than three nights", () => {
    const summary = summarise([420, 90]);
    expect(summary.consistency).toBe("unknown");
  });

  it("calls near-identical nights consistent", () => {
    const summary = summarise([410, 420, 415, 405, 425]);
    expect(summary.consistency).toBe("consistent");
  });

  it("calls wildly different nights irregular, not merely variable", () => {
    const summary = summarise([600, 180, 500, 200, 550]);
    expect(summary.consistency).toBe("irregular");
  });

  it("does not claim a trend from fewer than four nights", () => {
    const summary = summarise([600, 200, 180]);
    expect(summary.trend).toBe("unknown");
  });

  it("detects a genuine upward trend (recent nights longer than earlier ones)", () => {
    // Most recent first: 480,470 (recent) vs 300,310 (prior).
    const summary = summarise([480, 470, 300, 310]);
    expect(summary.trend).toBe("up");
  });

  it("detects a genuine downward trend", () => {
    const summary = summarise([300, 310, 480, 470]);
    expect(summary.trend).toBe("down");
  });

  it("calls a small difference flat rather than a false trend", () => {
    const summary = summarise([420, 415, 410, 425]);
    expect(summary.trend).toBe("flat");
  });
});
