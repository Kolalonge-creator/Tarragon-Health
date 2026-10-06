import { describe, expect, it } from "@jest/globals";
import { ackPercent, bandCounts, dashboardSchema, dashboardSettings, handbackRate, secondsLabel, waitLabel } from "./model";

const base = {
  viewer: "ops",
  generated_at: "2026-10-06T10:00:00Z",
  window_days: 90,
  tasks: { waiting: [], claimed: 0, claimed_past_due: 0 },
  pages: { window_minutes: 5, total: 0, acknowledged: 0, acknowledged_in_window: 0, no_cover: 0, median_ack_seconds: null, p90_ack_seconds: null, unacknowledged: [] },
  cover: { covered_now: false, primary_on_call: false, backup_on_call: false, gap_days: 7, gaps: [] },
  handbacks: {},
  distribution: { clinicians: 0, min_group: 5, suppressed: false, scores: [] },
};

describe("dashboardSchema", () => {
  it("accepts the ops shape with no individuals", () => {
    expect(dashboardSchema.safeParse(base).success).toBe(true);
  });
  it("accepts the lead shape with individuals and on-call names", () => {
    const r = dashboardSchema.safeParse({ ...base, viewer: "lead", on_call: { primary: "A", backup: null }, individuals: [{ name: "A", tier: "senior_medical_officer", score: 91.5, events: 4, handbacks: 1 }] });
    expect(r.success).toBe(true);
  });
  it("rejects a malformed answer so the screen shows a load failure, not zeros", () => {
    expect(dashboardSchema.safeParse({ ...base, tasks: { claimed: 0 } }).success).toBe(false);
    expect(dashboardSchema.safeParse({}).success).toBe(false);
    expect(dashboardSchema.safeParse(null).success).toBe(false);
  });
});

describe("handbackRate", () => {
  it("is null with nothing to divide", () => expect(handbackRate({}).percent).toBeNull());
  it("counts both hand-back kinds over every claimed outcome", () => {
    expect(handbackRate({ handed_back_other: 1, handed_back_reasoned: 1, completed_on_time: 6, completed_late: 1, claim_expired: 1 })).toEqual({ handedBack: 2, total: 10, percent: 20 });
  });
});

describe("bandCounts", () => {
  const bands = [{ key: "c", min: 0 }, { key: "a", min: 85 }, { key: "b", min: 70 }];
  it("groups from the top band down, whatever order the bands arrive in", () => {
    expect(bandCounts([95, 85, 84.9, 70, 69, 0], bands).map((b) => [b.key, b.count])).toEqual([["a", 2], ["b", 2], ["c", 2]]);
  });
  it("returns zero counts for no scores", () => expect(bandCounts([], bands).every((b) => b.count === 0)).toBe(true));
});

describe("labels and settings", () => {
  it("ackPercent rounds and is null for no pages", () => {
    expect(ackPercent({ ...base.pages, total: 3, acknowledged_in_window: 2 })).toBe(67);
    expect(ackPercent(base.pages)).toBeNull();
  });
  it("formats waits", () => {
    expect(waitLabel(0)).toBe("<1 min");
    expect(waitLabel(45)).toBe("45 min");
    expect(waitLabel(125)).toBe("2 h 5 min");
    expect(waitLabel(120)).toBe("2 h");
    expect(secondsLabel(null)).toBe("-");
    expect(secondsLabel(30)).toBe("30 s");
    expect(secondsLabel(300)).toBe("5 min");
  });
  it("reads the display settings from the registry", () => {
    const s = dashboardSettings();
    expect(s.gap_days).toBe(7);
    expect(s.min_group).toBeGreaterThanOrEqual(2);
    expect(s.bands.map((b) => b.min)).toEqual(expect.arrayContaining([0]));
  });
});
