import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { computeReadiness, parseReadinessConfig, ReadinessConfigError, type ReadinessConfig, type ReadinessInput, type TimedValue } from "./readiness";

const CFG = parseReadinessConfig((getProposedConfig("today.home_cards").value as { readiness: unknown }).readiness);
const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-21T08:00:00Z");

/** `values[0]` is the latest, taken `latestHoursAgo` hours ago; the rest are one per earlier day. */
function series(values: number[], latestHoursAgo = 2): TimedValue[] {
  return values.map((value, i) => ({ value, atMs: NOW - latestHoursAgo * HOUR - i * 24 * HOUR }));
}
const usual = (n: number, v: number) => Array.from({ length: n }, () => v);
const input = (over: Partial<ReadinessInput>): ReadinessInput => ({ nowMs: NOW, hasDevice: true, sleepMinutes: [], hrvMs: [], restingHr: [], ...over });

describe("parseReadinessConfig", () => {
  const good = () => ({ ...(getProposedConfig("today.home_cards").value as { readiness: Record<string, unknown> }).readiness });
  it("reads the proposed configuration", () => {
    expect(CFG.enabled).toBe(true);
    expect(CFG.minSignals).toBe(2);
  });
  it("refuses a bad configuration", () => {
    for (const bad of [null, [], "x"]) expect(() => parseReadinessConfig(bad)).toThrow(ReadinessConfigError);
    expect(() => parseReadinessConfig({ ...good(), enabled: "yes" })).toThrow(ReadinessConfigError);
    expect(() => parseReadinessConfig({ ...good(), max_age_hours: 0 })).toThrow(ReadinessConfigError);
    expect(() => parseReadinessConfig({ ...good(), sleep_drop_pct: -1 })).toThrow(ReadinessConfigError);
    expect(() => parseReadinessConfig({ ...good(), hrv_rise_pct: "5" })).toThrow(ReadinessConfigError);
    expect(() => parseReadinessConfig({ ...good(), min_signals: 4 })).toThrow(ReadinessConfigError);
    expect(() => parseReadinessConfig({ ...good(), min_baseline_days: 30 })).toThrow(ReadinessConfigError);
  });
});

describe("computeReadiness: dormant until there is something real to say", () => {
  const full = input({ sleepMinutes: series([420, ...usual(8, 420)]), hrvMs: series([50, ...usual(8, 50)]), restingHr: series([60, ...usual(8, 60)]) });

  it("is none when the setting is off", () => {
    expect(computeReadiness({ ...CFG, enabled: false } as ReadinessConfig, full)).toEqual({ kind: "none", reason: "switched_off" });
  });
  it("is none for someone without a device, whatever data exists", () => {
    expect(computeReadiness(CFG, { ...full, hasDevice: false })).toEqual({ kind: "none", reason: "no_device" });
  });
  it("is none when the device has stored nothing", () => {
    expect(computeReadiness(CFG, input({}))).toEqual({ kind: "none", reason: "no_recent_data" });
  });
  it("is none when the latest value is too old", () => {
    const old = input({ sleepMinutes: series([420, ...usual(8, 420)], 48), hrvMs: series([50, ...usual(8, 50)], 48) });
    expect(computeReadiness(CFG, old)).toEqual({ kind: "none", reason: "no_recent_data" });
  });
  it("is none when there are too few earlier days to know what is usual", () => {
    const thin = input({ sleepMinutes: series([420, ...usual(2, 420)]), hrvMs: series([50, ...usual(2, 50)]), restingHr: series([60, ...usual(2, 60)]) });
    expect(computeReadiness(CFG, thin)).toEqual({ kind: "none", reason: "not_enough_history" });
  });
  it("is none when only one signal can be read", () => {
    expect(computeReadiness(CFG, input({ sleepMinutes: series([420, ...usual(8, 420)]) }))).toEqual({ kind: "none", reason: "not_enough_signals" });
  });
  it("ignores values from the future, bad numbers and days outside the baseline window", () => {
    const messy = input({
      sleepMinutes: [...series([420, ...usual(8, 420)]), { atMs: NOW + HOUR, value: 100 }, { atMs: Number.NaN, value: 1 }, { atMs: NOW - 3 * HOUR, value: Number.NaN }],
      hrvMs: [...series([50, ...usual(8, 50)]), { atMs: NOW - 40 * 24 * HOUR, value: 5 }],
    });
    expect(computeReadiness(CFG, messy)).toEqual({ kind: "band", band: "steady", moves: [] });
  });
});

describe("computeReadiness: bands", () => {
  it("steady when everything is close to the person's usual", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([415, ...usual(8, 420)]), hrvMs: series([49, ...usual(8, 50)]), restingHr: series([61, ...usual(8, 60)]) }));
    expect(r).toEqual({ kind: "band", band: "steady", moves: [] });
  });

  it("take it easier when two signals moved the unhelpful way", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([300, ...usual(8, 420)]), hrvMs: series([38, ...usual(8, 50)]), restingHr: series([60, ...usual(8, 60)]) }));
    expect(r).toEqual({
      kind: "band",
      band: "take_it_easier",
      moves: [
        { signal: "sleep", move: "unhelpful" },
        { signal: "hrv", move: "unhelpful" },
      ],
    });
  });

  it("take it easier through resting heart rate and sleep", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([300, ...usual(8, 420)]), restingHr: series([68, ...usual(8, 60)]) }));
    expect(r.kind === "band" && r.band).toBe("take_it_easier");
  });

  it("one unhelpful signal alone is steady, not a warning", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([300, ...usual(8, 420)]), hrvMs: series([50, ...usual(8, 50)]), restingHr: series([60, ...usual(8, 60)]) }));
    expect(r).toEqual({ kind: "band", band: "steady", moves: [{ signal: "sleep", move: "unhelpful" }] });
  });

  it("rested when nothing is off and a signal is a little better", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([420, ...usual(8, 420)]), hrvMs: series([56, ...usual(8, 50)]) }));
    expect(r).toEqual({ kind: "band", band: "rested", moves: [{ signal: "hrv", move: "helpful" }] });
  });

  it("a helpful signal cannot hide an unhelpful one", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([300, ...usual(8, 420)]), hrvMs: series([56, ...usual(8, 50)]) }));
    expect(r.kind === "band" && r.band).toBe("steady");
  });

  it("uses the median of the earlier days, so one odd night does not move the usual", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([420, 420, 420, 420, 100, 420, 420, 420]), hrvMs: series([50, 50, 50, 50, 50, 50, 50, 50]) }));
    expect(r).toEqual({ kind: "band", band: "steady", moves: [] });
  });

  it("uses the middle two values when the earlier days are an even number", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([300, 400, 440, 400, 440, 400, 440]), hrvMs: series([50, ...usual(6, 50)]) }));
    expect(r.kind === "band" && r.moves).toEqual([{ signal: "sleep", move: "unhelpful" }]);
  });

  it("keeps only the latest value of a day", () => {
    const twice = [...series([420, ...usual(8, 420)]), { atMs: NOW - 2 * HOUR - 10 * 60_000, value: 10 }];
    const r = computeReadiness(CFG, input({ sleepMinutes: twice, hrvMs: series([50, ...usual(8, 50)]) }));
    expect(r).toEqual({ kind: "band", band: "steady", moves: [] });
  });

  it("skips a signal whose usual is zero instead of dividing by it", () => {
    const r = computeReadiness(CFG, input({ sleepMinutes: series([420, ...usual(8, 0)]), hrvMs: series([50, ...usual(8, 0)]), restingHr: series([60, ...usual(8, 60)]) }));
    expect(r).toEqual({ kind: "none", reason: "not_enough_signals" });
  });
});
