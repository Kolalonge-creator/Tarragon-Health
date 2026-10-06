import { describe, expect, it } from "@jest/globals";
import {
  BREATHING_LIMITS,
  BreathingConfigError,
  bre01Pace,
  breathsPerMinute,
  cueSchedule,
  mayStartSession,
  paceFromConfig,
  sessionMs,
  stateAt,
  totalBreaths,
  validatePace,
} from "./breathing";
import { PROPOSED_CONFIG } from "./proposed-config";

const STD = { inhaleSeconds: 4, exhaleSeconds: 6, durationSeconds: 180 };

describe("breathing pace", () => {
  it("reads the registered pace: six breaths a minute with a longer out-breath", () => {
    const { pace, configVersion } = bre01Pace("standard", "2026-10-07");
    expect(pace).toEqual(STD);
    expect(breathsPerMinute(pace)).toBe(6);
    expect(pace.exhaleSeconds).toBeGreaterThan(pace.inhaleSeconds);
    expect(configVersion).toBe(1);
  });

  it("offers a gentler and a shorter variant, all inside the limits", () => {
    const gentle = bre01Pace("gentle").pace;
    const short = bre01Pace("short").pace;
    expect(gentle.inhaleSeconds + gentle.exhaleSeconds).toBeLessThan(10);
    expect(breathsPerMinute(gentle)).toBeLessThanOrEqual(BREATHING_LIMITS.maxBreathsPerMinute);
    expect(short.durationSeconds).toBe(60);
    expect(short.inhaleSeconds).toBe(4);
  });

  it("is owned by the CMO and still proposed, so the founder screen will list it", () => {
    const e = PROPOSED_CONFIG.find((c) => c.key === "breathing.bre01");
    expect(e?.owner).toBe("CMO");
    expect(e?.status).toBe("proposed");
  });

  it("rejects a pace that holds the breath, hurries, or has a shorter out-breath", () => {
    expect(() => validatePace({ ...STD, exhaleSeconds: 3 })).toThrow(BreathingConfigError); // out shorter than in
    expect(() => validatePace({ ...STD, inhaleSeconds: 2, exhaleSeconds: 2 })).toThrow(/breaths a minute/); // 15 a minute
    expect(() => validatePace({ ...STD, inhaleSeconds: 10, exhaleSeconds: 10 })).toThrow(/breaths a minute/); // 3 a minute
    expect(() => validatePace({ ...STD, inhaleSeconds: 1 })).toThrow(/inhaleSeconds/);
    expect(() => validatePace({ ...STD, exhaleSeconds: 11 })).toThrow(/exhaleSeconds/);
    expect(() => validatePace({ ...STD, durationSeconds: 10 })).toThrow(/durationSeconds/);
    expect(() => validatePace({ ...STD, durationSeconds: 5000 })).toThrow(/durationSeconds/);
    expect(() => validatePace({ ...STD, inhaleSeconds: Number.NaN })).toThrow(BreathingConfigError);
  });

  it("rejects a malformed registry value instead of guessing", () => {
    expect(() => paceFromConfig(null)).toThrow(/not an object/);
    expect(() => paceFromConfig([1, 2])).toThrow(/not an object/);
    expect(() => paceFromConfig({ inhale_seconds: 4 })).toThrow(/exhale_seconds/);
    expect(() => paceFromConfig({ inhale_seconds: 4, exhale_seconds: 6, duration_seconds: "180" })).toThrow(/duration_seconds/);
  });
});

describe("breathing session state", () => {
  it("counts whole breaths and ends on a full out-breath", () => {
    expect(totalBreaths(STD)).toBe(18);
    expect(sessionMs(STD)).toBe(180_000);
    const odd = { inhaleSeconds: 4, exhaleSeconds: 6, durationSeconds: 65 };
    expect(totalBreaths(odd)).toBe(6);
    expect(sessionMs(odd)).toBe(60_000);
  });

  it("starts empty on an in-breath, fills for four seconds, then empties for six", () => {
    expect(stateAt(STD, 0)).toMatchObject({ phase: "in", fill: 0, secondsLeft: 4, breath: 1, finished: false });
    expect(stateAt(STD, 2000)).toMatchObject({ phase: "in", fill: 0.5, secondsLeft: 2 });
    expect(stateAt(STD, 4000)).toMatchObject({ phase: "out", fill: 1, secondsLeft: 6 });
    expect(stateAt(STD, 7000)).toMatchObject({ phase: "out", secondsLeft: 3 });
    expect(stateAt(STD, 7000).fill).toBeCloseTo(0.5, 5);
    expect(stateAt(STD, 10_000)).toMatchObject({ phase: "in", breath: 2 });
  });

  it("finishes at the end and stays finished", () => {
    expect(stateAt(STD, 179_999)).toMatchObject({ finished: false, breath: 18 });
    expect(stateAt(STD, 180_000)).toMatchObject({ finished: true, fill: 0, secondsLeft: 0, breath: 18 });
    expect(stateAt(STD, 999_999)).toMatchObject({ finished: true, elapsedMs: 180_000 });
  });

  it("treats negative time as the start", () => {
    expect(stateAt(STD, -500).elapsedMs).toBe(0);
  });

  it("schedules a cue at every phase change", () => {
    const cues = cueSchedule(STD);
    expect(cues).toHaveLength(36);
    expect(cues[0]).toEqual({ atMs: 0, phase: "in" });
    expect(cues[1]).toEqual({ atMs: 4000, phase: "out" });
    expect(cues[2]).toEqual({ atMs: 10_000, phase: "in" });
    expect(cues.at(-1)).toEqual({ atMs: 174_000, phase: "out" });
  });
});

describe("safety card gate", () => {
  it("allows a session only after the safety card is acknowledged", () => {
    expect(mayStartSession(false)).toBe(false);
    expect(mayStartSession(true)).toBe(true);
    expect(mayStartSession(undefined as unknown as boolean)).toBe(false);
  });
});
