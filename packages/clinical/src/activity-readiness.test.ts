import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { assessReadiness, readinessMessageKeys, type ReadinessBandsConfig, type WearableReadingPoint } from "./activity-readiness";

const cfg = getProposedConfig("activity.readiness_bands").value as unknown as ReadinessBandsConfig;
const NOW = new Date("2026-10-21T10:00:00Z");

function dayIso(daysAgo: number): string {
  return new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
}
/** one reading a day for `days` days ago .. 0, value from fn(daysAgo) */
function series(type: string, days: number, fn: (d: number) => number): WearableReadingPoint[] {
  return Array.from({ length: days + 1 }, (_, d) => ({ readingType: type, value: fn(d), recordedAt: dayIso(d) }));
}

describe("assessReadiness", () => {
  it("says nothing with no readings (dormant until provider data exists)", () => {
    const r = assessReadiness([], NOW, cfg);
    expect(r.state).toBe("no_data");
    expect(readinessMessageKeys(r)).toEqual({ recovery: null, sleep: null, load: null });
    expect(r.estimate).toBe(true);
  });

  it("says nothing with too little history to compare", () => {
    expect(assessReadiness(series("recovery_score", 4, () => 60), NOW, cfg).state).toBe("no_data");
  });

  it("ignores unreadable values and instants", () => {
    const bad: WearableReadingPoint[] = [
      { readingType: "recovery_score", value: Number.NaN, recordedAt: dayIso(0) },
      { readingType: "recovery_score", value: -5, recordedAt: dayIso(0) },
      { readingType: "recovery_score", value: 50, recordedAt: "not a date" },
    ];
    expect(assessReadiness(bad, NOW, cfg).state).toBe("no_data");
    expect(assessReadiness(bad, new Date("2026-10-21T10:00:00Z"), cfg).state).toBe("no_data");
  });

  it("recovery: lower, usual and higher than the person's own usual", () => {
    const lower = assessReadiness(series("recovery_score", 30, (d) => (d < 3 ? 40 : 70)), NOW, cfg);
    expect(lower.recovery).toEqual({ metric: "recovery_score", level: "lower" });
    expect(assessReadiness(series("recovery_score", 30, () => 70), NOW, cfg).recovery?.level).toBe("usual");
    expect(assessReadiness(series("recovery_score", 30, (d) => (d < 3 ? 90 : 70)), NOW, cfg).recovery?.level).toBe("higher");
  });

  it("falls back to HRV when there is no recovery score", () => {
    const r = assessReadiness(series("hrv_ms", 30, (d) => (d < 3 ? 30 : 60)), NOW, cfg);
    expect(r.recovery).toEqual({ metric: "hrv_ms", level: "lower" });
  });

  it("sleep adds up the segments of a night", () => {
    const seg = (d: number) => (d < 3 ? 150 : 240);
    const usual = [...series("sleep_minutes", 30, () => 240), ...series("sleep_minutes", 30, () => 240)];
    expect(assessReadiness(usual, NOW, cfg).sleep?.level).toBe("usual");
    const short = [...series("sleep_minutes", 30, seg), ...series("sleep_minutes", 30, seg)];
    expect(assessReadiness(short, NOW, cfg).sleep?.level).toBe("lower");
  });

  it("training load: lighter, usual, heavier week against the person's own four weeks", () => {
    expect(assessReadiness(series("strain", 30, (d) => (d < 7 ? 16 : 8)), NOW, cfg).load).toEqual({ metric: "strain", level: "heavier" });
    expect(assessReadiness(series("strain", 30, () => 10), NOW, cfg).load?.level).toBe("usual");
    expect(assessReadiness(series("steps", 30, (d) => (d < 7 ? 2000 : 9000)), NOW, cfg).load).toEqual({ metric: "steps", level: "lighter" });
  });

  it("steps are a running total, so the day's largest reading counts once", () => {
    const readings = series("steps", 30, () => 5000).flatMap((r) => [r, { ...r, value: 2000 }]);
    expect(assessReadiness(readings, NOW, cfg).load?.level).toBe("usual");
  });

  it("needs enough weeks of data for a load band", () => {
    expect(assessReadiness(series("steps", 10, () => 5000), NOW, cfg).load).toBeNull();
  });

  it("a zero baseline gives no band rather than a divide by zero", () => {
    expect(assessReadiness(series("recovery_score", 30, () => 0), NOW, cfg).state).toBe("no_data");
  });

  it("wording keys are descriptive only", () => {
    const keys = readinessMessageKeys(assessReadiness(series("recovery_score", 30, (d) => (d < 3 ? 40 : 70)), NOW, cfg));
    expect(keys.recovery).toBe("activity.readiness.recovery.lower");
  });

  it("the config is PROPOSED and owned by the CMO", () => {
    const e = getProposedConfig("activity.readiness_bands");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });
});
