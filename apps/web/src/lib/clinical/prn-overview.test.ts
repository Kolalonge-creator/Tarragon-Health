import { describe, expect, it } from "@jest/globals";
import { parsePrnOverviewPayload } from "./prn-overview";

describe("parsePrnOverviewPayload", () => {
  it("reads limits and flag counts", () => {
    expect(
      parsePrnOverviewPayload({
        status: "ok",
        limits: [{ medication_id: "m1", min_gap_minutes: 240, daily_max: null, set_at: "2026-10-13T10:00:00Z" }],
        flagged_last_7_days: [{ medication_id: "m1", doses: 2 }],
      }),
    ).toEqual({
      status: "ok",
      limits: [{ medicationId: "m1", minGapMinutes: 240, dailyMax: null, setAt: "2026-10-13T10:00:00Z" }],
      flagged: [{ medicationId: "m1", doses: 2 }],
    });
  });
  it("passes a refusal through as denied, never as empty", () => {
    expect(parsePrnOverviewPayload({ status: "denied" })).toEqual({ status: "denied" });
  });
  it("treats anything malformed as an error, never as no limits", () => {
    for (const bad of [null, "x", { status: "ok" }, { status: "ok", limits: [{}], flagged_last_7_days: [] },
      { status: "ok", limits: [{ medication_id: "m", set_at: "t", min_gap_minutes: "4" }], flagged_last_7_days: [] },
      { status: "ok", limits: [], flagged_last_7_days: [{ medication_id: "m", doses: "2" }] }]) {
      expect(parsePrnOverviewPayload(bad).status).toBe("error");
    }
  });
});
