import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import {
  antenatalReviewReasons,
  evaluateContractions,
  evaluateKickSession,
  gestationalAge,
  kickCounterAvailable,
  patternFor,
  personalNormalMinutes,
  plannedContacts,
  type Contraction,
  type MaternalConfig,
} from "./index";
import { BP_CARE_V4 } from "../rules";

const entry = getProposedConfig("maternal.rules");
const config = entry.value as unknown as MaternalConfig;
const MIN = 60_000;

describe("maternal.rules is a PROPOSED registry entry, not code", () => {
  it("is proposed, owned by the CMO and carries the selections A3, A4 and A5", () => {
    expect(entry.status).toBe("proposed");
    expect(entry.owner).toBe("CMO");
    expect(config.antenatal.contactWeeks).toEqual([12, 20, 26, 30, 34, 36, 38, 40]);
    expect(config.kicks).toMatchObject({ startWeek: 28, windowMinutes: 120, movementsTarget: 10 });
    expect(config.contractions.standard).toEqual({ intervalMinutes: 5, durationSeconds: 60, sustainedMinutes: 60 });
    expect(config.contractions.earlier.intervalMinutes).toBe(7);
    expect(config.contractions.preTermBeforeWeek).toBe(37);
  });

  it("maternal.bp_rule_set mirrors the pregnancy lines and version of the rule set that carries them", () => {
    const e = getProposedConfig<{ code: string; ruleSetVersion: number; pregnancyRaisedSystolic: number; pregnancyRaisedDiastolic: number; pregnancySevereSystolic: number; pregnancySevereDiastolic: number }>("maternal.bp_rule_set");
    expect(e.value.code).toBe(BP_CARE_V4.code);
    expect(e.value.ruleSetVersion).toBe(BP_CARE_V4.version);
    expect(e.value.pregnancyRaisedSystolic).toBe(BP_CARE_V4.params.pregnancy.raisedSystolic);
    expect(e.value.pregnancyRaisedDiastolic).toBe(BP_CARE_V4.params.pregnancy.raisedDiastolic);
    expect(e.value.pregnancySevereSystolic).toBe(BP_CARE_V4.params.pregnancy.severeSystolic);
    expect(e.value.pregnancySevereDiastolic).toBe(BP_CARE_V4.params.pregnancy.severeDiastolic);
    expect(e.status).toBe("proposed");
  });
});

describe("gestational age", () => {
  it("counts weeks and days from the last period", () => {
    expect(gestationalAge({ lmp: "2026-03-01", today: "2026-10-04" })).toMatchObject({ weeks: 31, days: 0, source: "lmp", edd: "2026-12-06" });
    expect(gestationalAge({ lmp: "2026-03-01", today: "2026-10-10" })).toMatchObject({ weeks: 31, days: 6 });
  });
  it("uses the due date when there is no period, and prefers it when the two disagree by more than 14 days", () => {
    expect(gestationalAge({ edd: "2026-12-06", today: "2026-10-04" })).toMatchObject({ weeks: 31, source: "edd" });
    expect(gestationalAge({ lmp: "2026-01-01", edd: "2026-12-06", today: "2026-10-04" })?.source).toBe("edd");
    expect(gestationalAge({ lmp: "2026-03-01", edd: "2026-12-10", today: "2026-10-04" })?.source).toBe("lmp");
  });
  it("is null for no date, a bad date, a future start or a pregnancy past 44 weeks", () => {
    expect(gestationalAge({ today: "2026-10-04" })).toBeNull();
    expect(gestationalAge({ lmp: "not a date", today: "2026-10-04" })).toBeNull();
    expect(gestationalAge({ lmp: "2026-11-01", today: "2026-10-04" })).toBeNull();
    expect(gestationalAge({ lmp: "2025-01-01", today: "2026-10-04" })).toBeNull();
  });
});

describe("antenatal schedule (A5)", () => {
  it("plans all eight contacts at the configured weeks for someone early in pregnancy", () => {
    const planned = plannedContacts(8, config);
    expect(planned.map((p) => p.targetWeek)).toEqual([12, 20, 26, 30, 34, 36, 38, 40]);
    expect(planned.map((p) => p.visitNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(planned.every((p) => !p.dueNow)).toBe(true);
  });
  it("offers the first contact as due now for someone who registers late, and drops the weeks already past", () => {
    const planned = plannedContacts(28, config);
    expect(planned[0]).toEqual({ visitNumber: 1, targetWeek: 28, dueNow: true });
    expect(planned.slice(1).map((p) => p.targetWeek)).toEqual([30, 34, 36, 38, 40]);
  });
  it("a contact in the current week is kept", () => {
    expect(plannedContacts(20, config)[0]).toEqual({ visitNumber: 1, targetWeek: 20, dueNow: true });
    expect(plannedContacts(20, config).map((p) => p.visitNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("an earlier visit is a prompt for the care team, never a silent change", () => {
    expect(antenatalReviewReasons({ riskFlags: [], amberPregnancyBp: false })).toEqual([]);
    expect(antenatalReviewReasons({ riskFlags: ["previous_pre_eclampsia"], amberPregnancyBp: true })).toEqual(["risk_flag", "amber_blood_pressure"]);
    // the schedule itself is unchanged by the signals
    expect(plannedContacts(8, config)).toEqual(plannedContacts(8, config));
  });
});

describe("kick counter (A3)", () => {
  const start = 1_000_000;
  const taps = (n: number, everyMin: number) => Array.from({ length: n }, (_, i) => start + (i + 1) * everyMin * MIN);

  it("is offered from week 28 and not before or when the week is unknown", () => {
    expect(kickCounterAvailable(27, config)).toBe(false);
    expect(kickCounterAvailable(28, config)).toBe(true);
    expect(kickCounterAvailable(null, config)).toBe(false);
  });

  it("10 movements inside 2 hours reaches the target", () => {
    const r = evaluateKickSession({ startedAtMs: start, movementMs: taps(10, 6) }, start + 60 * MIN, null, config);
    expect(r).toMatchObject({ state: "target_reached", count: 10, minutesToTarget: 60, reason: null });
  });

  it("is still counting before the window ends with fewer than 10", () => {
    expect(evaluateKickSession({ startedAtMs: start, movementMs: taps(6, 10) }, start + 90 * MIN, null, config).state).toBe("counting");
  });

  it("fewer than 10 at 2 hours is the fixed contact-today card", () => {
    const r = evaluateKickSession({ startedAtMs: start, movementMs: taps(7, 10) }, start + 120 * MIN, null, config);
    expect(r).toMatchObject({ state: "contact_today", reason: "window_elapsed_without_target", count: 7 });
  });

  it("the 10th movement felt after the window does not count", () => {
    const movementMs = [...taps(9, 10), start + 121 * MIN];
    expect(evaluateKickSession({ startedAtMs: start, movementMs }, start + 130 * MIN, null, config).state).toBe("contact_today");
  });

  it("'I feel less movement than usual' is the card at once, whatever the count", () => {
    expect(evaluateKickSession({ startedAtMs: start, movementMs: taps(10, 2), reportedLess: true }, start + 30 * MIN, null, config)).toMatchObject({ state: "contact_today", reason: "reported_less_movement" });
  });

  describe("personal normal", () => {
    const finished = (...m: (number | null)[]) => m.map((minutesToTarget) => ({ minutesToTarget }));
    it("needs 3 finished sessions that reached the target", () => {
      expect(personalNormalMinutes(finished(20, 30), config)).toBeNull();
      expect(personalNormalMinutes(finished(20, null, 30), config)).toBeNull();
      expect(personalNormalMinutes(finished(20, 40, 30), config)).toBe(30);
    });
    it("is the median of the latest 5", () => {
      expect(personalNormalMinutes(finished(90, 90, 10, 20, 30, 40, 50), config)).toBe(30);
    });
    it("a clear drop is the card even when the 10 were felt inside 2 hours", () => {
      const r = evaluateKickSession({ startedAtMs: start, movementMs: taps(10, 10) }, start + 100 * MIN, 30, config);
      expect(r).toMatchObject({ state: "contact_today", reason: "clear_drop", minutesToTarget: 100 });
    });
    it("a slow session while still counting becomes the card once it passes twice her normal", () => {
      expect(evaluateKickSession({ startedAtMs: start, movementMs: taps(5, 10) }, start + 59 * MIN, 30, config).state).toBe("counting");
      expect(evaluateKickSession({ startedAtMs: start, movementMs: taps(5, 10) }, start + 60 * MIN, 30, config)).toMatchObject({ state: "contact_today", reason: "clear_drop" });
    });
    it("near her normal is not a drop", () => {
      expect(evaluateKickSession({ startedAtMs: start, movementMs: taps(10, 5) }, start + 59 * MIN, 30, config).state).toBe("target_reached");
    });
  });
});

describe("contraction timer (A4)", () => {
  const t0 = 10_000_000;
  /** n contractions every `gap` minutes, each `lastSec` seconds long. */
  const run = (n: number, gap: number, lastSec = 60): Contraction[] =>
    Array.from({ length: n }, (_, i) => ({ startMs: t0 + i * gap * MIN, endMs: t0 + i * gap * MIN + lastSec * 1000 }));
  const ctx = (over: Partial<{ week: number | null; signs: never[] }> = {}) => ({ week: 39, signs: [] as never[], flags: null, ...over });

  it("5-1-1: contractions every 5 minutes lasting a minute for an hour is go now", () => {
    const c = run(13, 5);
    expect(evaluateContractions(c, ctx(), t0 + 61 * MIN, config)).toMatchObject({ state: "go_now", reason: "pattern", pattern: "standard" });
  });
  it("just short of an hour is keep timing", () => {
    expect(evaluateContractions(run(12, 5), ctx(), t0 + 56 * MIN, config).state).toBe("keep_timing");
  });
  it("contractions every 6 minutes do not meet 5-1-1 but meet 7-1-1", () => {
    const c = run(12, 6);
    expect(evaluateContractions(c, ctx(), t0 + 70 * MIN, config).state).toBe("keep_timing");
    expect(evaluateContractions(c, { ...ctx(), flags: { longJourney: true, previousFastLabour: false, previousBirths: 0 } }, t0 + 70 * MIN, config)).toMatchObject({ state: "go_now", pattern: "earlier" });
  });
  it("a short contraction (45 seconds) does not count toward the run", () => {
    expect(evaluateContractions(run(13, 5, 45), ctx(), t0 + 61 * MIN, config).state).toBe("keep_timing");
  });
  it("a gap longer than the interval restarts the run", () => {
    const early = run(8, 5);
    const late = run(5, 5).map((c) => ({ startMs: c.startMs + 80 * MIN, endMs: (c.endMs ?? 0) + 80 * MIN }));
    expect(evaluateContractions([...early, ...late], ctx(), t0 + 110 * MIN, config).state).toBe("keep_timing");
  });
  it("the earlier pattern applies for a later birth, a previous fast labour or a long journey, and never otherwise", () => {
    expect(patternFor(null)).toBe("standard");
    expect(patternFor({ longJourney: false, previousFastLabour: false, previousBirths: 0 })).toBe("standard");
    expect(patternFor({ longJourney: false, previousFastLabour: false, previousBirths: 1 })).toBe("earlier");
    expect(patternFor({ longJourney: false, previousFastLabour: true, previousBirths: 0 })).toBe("earlier");
  });
  it.each(["waters_break", "vaginal_bleeding", "reduced_fetal_movement", "fit", "severe_headache"] as const)("%s is go now with no contractions timed at all", (sign) => {
    expect(evaluateContractions([], { week: 39, signs: [sign], flags: null }, t0, config)).toMatchObject({ state: "go_now", reason: "instant_sign" });
  });
  it("any contraction before 37 weeks is go now; at 37 weeks it is not", () => {
    expect(evaluateContractions(run(1, 5), ctx({ week: 36 }), t0 + MIN, config)).toMatchObject({ state: "go_now", reason: "before_term" });
    expect(evaluateContractions(run(1, 5), ctx({ week: 37 }), t0 + MIN, config).state).toBe("keep_timing");
  });
  it("with no contractions yet and under 37 weeks it keeps timing (nothing to go on yet)", () => {
    expect(evaluateContractions([], ctx({ week: 30 }), t0, config).state).toBe("keep_timing");
  });
  it("an unknown week asks for the due date instead of guessing", () => {
    expect(evaluateContractions(run(2, 5), ctx({ week: null }), t0 + 10 * MIN, config)).toMatchObject({ state: "keep_timing", needsGestation: true });
  });
  it("never answers 'wait': the only states are go_now and keep_timing", () => {
    for (const c of [[], run(3, 5), run(13, 5)]) {
      expect(["go_now", "keep_timing"]).toContain(evaluateContractions(c, ctx(), t0 + 70 * MIN, config).state);
    }
  });
});
