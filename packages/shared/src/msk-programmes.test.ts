import { describe, expect, it } from "@jest/globals";
import { MSK_EXCLUSION_LISTS, MSK_INSTRUMENTS, MSK_PROGRAMME_CODES } from "./proposed-config/msk-config-data";
import {
  isActivityRest, isMskProgrammeCode, pegScore, readFlareUpOutcome, readMskExtras, readMskGate, readNotEnoughDays, selectDailySet,
  shouldOfferEasier, stepDownActive, validDifficulty,
} from "./msk-programmes";
import { mskExerciseRow } from "./therapy-content/msk-drafts";
import { assessWorsening, evaluateEntryScreen, therapyExclusionRules, therapyProgrammeConfig, validateScores, type TherapyAnswers } from "./therapy-programmes";
import { readStartOutcome } from "./therapy-results";

const walk = mskExerciseRow("walk");
const bridge = mskExerciseRow("bridge");
const bird = mskExerciseRow("bird_dog");
const stand = mskExerciseRow("sit_to_stand");

/** Answers that are all "no" for a list, with chosen items answered "yes". */
function answers(code: (typeof MSK_PROGRAMME_CODES)[number], yes: string[] = []): TherapyAnswers {
  return Object.fromEntries(MSK_EXCLUSION_LISTS[code].map((r) => [r.code, yes.includes(r.code)]));
}

describe("MSK entry screen (red flags as data, fail closed)", () => {
  it("a clean set of answers passes for every pain programme", () => {
    for (const c of MSK_PROGRAMME_CODES) expect(evaluateEntryScreen(therapyExclusionRules(c), answers(c)).passed).toBe(true);
  });

  it("every single item refuses on its own, with its own route (table-driven)", () => {
    for (const c of MSK_PROGRAMME_CODES) {
      for (const rule of MSK_EXCLUSION_LISTS[c]) {
        const r = evaluateEntryScreen(therapyExclusionRules(c), answers(c, [rule.code]));
        expect(r.passed).toBe(false);
        expect(r.route).toBe(rule.route);
        expect(r.stops.map((s) => s.code)).toEqual([rule.code]);
      }
    }
  });

  it("an unanswered item, a wrong kind of answer and no answers at all all refuse (fail closed)", () => {
    for (const c of MSK_PROGRAMME_CODES) {
      const rules = therapyExclusionRules(c);
      const [first] = MSK_EXCLUSION_LISTS[c];
      const missing = { ...answers(c) } as Record<string, unknown>;
      delete missing[first?.code ?? ""];
      expect(evaluateEntryScreen(rules, missing as TherapyAnswers).passed).toBe(false);
      expect(evaluateEntryScreen(rules, { ...answers(c), [first?.code ?? ""]: "no" as unknown as boolean }).passed).toBe(false);
      expect(evaluateEntryScreen(rules, {}).passed).toBe(false);
      expect(evaluateEntryScreen(rules, null).passed).toBe(false);
    }
  });

  it("covers the red flags the founder named", () => {
    const has = (c: (typeof MSK_PROGRAMME_CODES)[number], code: string, route: string) =>
      expect(MSK_EXCLUSION_LISTS[c].find((r) => r.code === code)?.route).toBe(route);
    // back
    for (const code of ["saddle_numbness", "bladder_or_bowel_change", "weakness_both_legs", "progressive_deficit", "recent_trauma", "fever", "low_defences", "cancer_history", "unexplained_weight_loss", "night_pain"]) {
      has("pain_back", code, "same_day_clinician");
    }
    has("pain_back", "steroids_or_thin_bones", "medical_review_first");
    has("pain_back", "pain_first_time_over_50", "medical_review_first");
    has("pain_back", "pregnant_or_recent_birth", "medical_review_first");
    has("pain_back", "chest_pain_now", "crisis");
    // neck
    has("pain_neck", "recent_trauma", "same_day_clinician");
    has("pain_neck", "arm_or_hand_weakness_or_numbness", "same_day_clinician");
    has("pain_neck", "balance_or_walking_change", "same_day_clinician");
    has("pain_neck", "sudden_severe_headache", "crisis");
    has("pain_neck", "chest_or_arm_pain_now", "crisis");
    // knee
    has("pain_knee", "hot_swollen_joint_unwell", "same_day_clinician");
    has("pain_knee", "cannot_weight_bear", "same_day_clinician");
    has("pain_knee", "calf_pain_or_swelling", "same_day_clinician");
    has("pain_knee", "breathless_with_leg_pain", "crisis");
    // hip
    has("pain_hip", "cannot_weight_bear", "same_day_clinician");
    has("pain_hip", "groin_pain_after_fall", "same_day_clinician");
    has("pain_hip", "fever", "same_day_clinician");
  });

  it("the most urgent route wins when several are positive", () => {
    const r = evaluateEntryScreen(therapyExclusionRules("pain_back"), answers("pain_back", ["steroids_or_thin_bones", "saddle_numbness", "chest_pain_now"]));
    expect(r.route).toBe("crisis");
  });

  it("no question carries a phone number or a helpline", () => {
    for (const c of MSK_PROGRAMME_CODES) for (const r of MSK_EXCLUSION_LISTS[c]) expect(r.question).not.toMatch(/\d{5,}|help ?line|hotline/i);
  });
});

describe("MSK outcome measures (free PEG plus one function goal)", () => {
  const cfg = therapyProgrammeConfig();

  it("the four pain programmes ask the PEG items and the function goal at weeks 1, 4 and 8 (not the licensed Oswestry)", () => {
    for (const c of MSK_PROGRAMME_CODES) {
      expect(cfg.instruments[c]).toEqual([...MSK_INSTRUMENTS]);
      expect(cfg.checkpoints[c]).toEqual([1, 4, 8]);
    }
    expect(JSON.stringify(cfg).toLowerCase()).not.toContain("oswestry");
  });

  it("scores are whole numbers from 0 to 10 and an item out of range is refused", () => {
    const ok = { peg_pain: 6, peg_enjoyment: 5, peg_activity: 7, function_goal: 6 };
    expect(validateScores("pain_back", 1, ok)).toBeNull();
    expect(validateScores("pain_back", 4, { ...ok, peg_pain: 11 })).toBe("out_of_range");
    expect(validateScores("pain_back", 4, { ...ok, peg_pain: 4.5 })).toBe("missing_instrument");
    expect(validateScores("pain_back", 2, ok)).toBe("not_a_checkpoint");
    expect(validateScores("pain_back", 1, { ...ok, pain_nrs: 3 })).toBe("unknown_instrument");
  });

  it("worsening beyond the PROPOSED rise on any item is found, below it is not", () => {
    const base = { peg_pain: 5, peg_enjoyment: 5, peg_activity: 5, function_goal: 5 };
    expect(assessWorsening(cfg.worsening, base, { ...base, peg_pain: 6 })).toEqual([]);
    const found = assessWorsening(cfg.worsening, base, { ...base, peg_activity: 7 });
    expect(found).toEqual([{ instrument: "peg_activity", baseline: 5, latest: 7, basis: "rise" }]);
    expect(assessWorsening(cfg.worsening, base, { ...base, function_goal: 8 }).map((f) => f.instrument)).toEqual(["function_goal"]);
  });

  it("a high first score alone does not pause the programme (there is no absolute line for these items)", () => {
    const high = { peg_pain: 9, peg_enjoyment: 9, peg_activity: 9, function_goal: 9 };
    expect(assessWorsening(cfg.worsening, high, high)).toEqual([]);
  });

  it("the PEG score is the mean of its three items", () => {
    expect(pegScore({ peg_pain: 6, peg_enjoyment: 5, peg_activity: 7 })).toBe(6);
    expect(pegScore({ peg_pain: 7, peg_enjoyment: 4, peg_activity: 4 })).toBe(5);
    expect(pegScore({ peg_pain: 7, peg_enjoyment: 4 })).toBeNull();
    expect(pegScore({ peg_pain: 11, peg_enjoyment: 4, peg_activity: 4 })).toBeNull();
  });
});

describe("daily exercise set", () => {
  const planned = [walk, bridge, bird, stand];

  it("is capped at the configured number", () => {
    const set = selectDailySet(planned, { gate: { decision: "allow", maxIntensity: "vigorous" }, stepDownRunning: false });
    expect(set.exercises.map((e) => e.key)).toEqual(["walk", "bridge", "bird_dog"]);
    expect(set.lighter).toBe(false);
  });

  it("a gentle-only gate removes moderate exercises and never leaves the day empty", () => {
    const set = selectDailySet([bird, stand, walk], { gate: { decision: "restrict", maxIntensity: "gentle" }, stepDownRunning: false });
    expect(set.exercises.map((e) => e.key)).toEqual(["walk"]);
    expect(set.reason).toBe("activity_gate");
    const onlyModerate = selectDailySet([bird, stand], { gate: { decision: "restrict", maxIntensity: "gentle" }, stepDownRunning: false });
    expect(onlyModerate.exercises).toEqual([]);
  });

  it("a rest answer shows no exercise at all", () => {
    expect(selectDailySet(planned, { gate: { decision: "rest", maxIntensity: "none" }, stepDownRunning: false }).exercises).toEqual([]);
  });

  it("a running step-down keeps gentle exercises only, at most the configured number", () => {
    const set = selectDailySet([walk, bridge, mskExerciseRow("knee_rock")], { gate: { decision: "allow", maxIntensity: "vigorous" }, stepDownRunning: true });
    expect(set.exercises.map((e) => e.key)).toEqual(["walk", "bridge"]);
    expect(set.reason).toBe("step_down");
  });

  it("a step-down runs through its last day inclusive and not after", () => {
    expect(stepDownActive({ until: "2026-10-29" }, "2026-10-29")).toBe(true);
    expect(stepDownActive({ until: "2026-10-29" }, "2026-10-30")).toBe(false);
    expect(stepDownActive(null, "2026-10-29")).toBe(false);
  });
});

describe("difficulty rating", () => {
  it("accepts 1 to 5 whole numbers only", () => {
    expect([1, 3, 5].every((n) => validDifficulty(n))).toBe(true);
    expect([0, 6, 2.5, "3", null].some((v) => validDifficulty(v))).toBe(false);
  });

  it("offers the easier version after two 'too hard' ratings in a row, not after one or after a break", () => {
    expect(shouldOfferEasier([5])).toBe(false);
    expect(shouldOfferEasier([5, 5])).toBe(true);
    expect(shouldOfferEasier([5, 3, 5])).toBe(false);
    expect(shouldOfferEasier([2, 5, 5])).toBe(true);
  });
});

describe("readers fail closed", () => {
  it("an unreadable activity gate is gentle only, never permissive", () => {
    expect(readMskGate(null)).toEqual({ decision: "restrict", maxIntensity: "gentle" });
    expect(readMskGate({ decision: "allow", max_intensity: "none" })).toEqual({ decision: "restrict", maxIntensity: "gentle" });
    expect(readMskGate({ decision: "bogus", max_intensity: "vigorous" })).toEqual({ decision: "restrict", maxIntensity: "gentle" });
    expect(readMskGate({ decision: "rest", max_intensity: "none" })).toEqual({ decision: "rest", maxIntensity: "none" });
  });

  it("start extras are read, and a malformed exercise list is refused whole", () => {
    const good = readMskExtras({
      exercises: [mskExerciseRow("walk")],
      activity_gate: { decision: "restrict", max_intensity: "gentle" },
      step_down: { until: "2026-10-29" },
      days_done: 1,
      days_needed: 3,
    });
    expect(good?.exercises[0]?.key).toBe("walk");
    expect(good?.stepDown).toEqual({ until: "2026-10-29" });
    expect(good?.daysNeeded).toBe(3);
    expect(readMskExtras({ exercises: [{ key: "walk" }] })).toBeNull();
    expect(readMskExtras({})).toBeNull();
  });

  it("the shared start reader carries the MSK extras", () => {
    const o = readStartOutcome({
      status: "ok",
      programme: { code: "pain_back", title: "t", total_sessions: 8 },
      session: { ordinal: 1, title: "x", text: "y", duration_seconds: 600 },
      checkpoint: true,
      instruments: [...MSK_INSTRUMENTS],
      exercises: [mskExerciseRow("walk")],
      activity_gate: { decision: "allow", max_intensity: "vigorous" },
    });
    expect(o.kind).toBe("ok");
    if (o.kind === "ok") expect(o.session.msk?.exercises).toHaveLength(1);
  });

  it("flare-up, rest and completion-gate answers", () => {
    expect(readFlareUpOutcome({ status: "stopped", route: "same_day_clinician", task_failed: false })).toEqual({ kind: "stopped", route: "same_day_clinician", taskFailed: false });
    expect(readFlareUpOutcome({ status: "stopped", route: "nonsense" })).toEqual({ kind: "stopped", route: null, taskFailed: false });
    expect(readFlareUpOutcome({ status: "step_down", until: "2026-10-29" })).toEqual({ kind: "step_down", until: "2026-10-29" });
    expect(readFlareUpOutcome({ status: "step_down", until: "soon" })).toEqual({ kind: "unknown" });
    expect(readFlareUpOutcome(null)).toEqual({ kind: "unknown" });
    expect(isActivityRest({ status: "activity_rest" })).toBe(true);
    expect(isActivityRest({ status: "ok" })).toBe(false);
    expect(readNotEnoughDays({ status: "not_enough_days", days_done: 1, days_needed: 3 })).toEqual({ daysDone: 1, daysNeeded: 3 });
    expect(readNotEnoughDays({ status: "ok" })).toBeNull();
  });

  it("knows its programme codes", () => {
    expect(isMskProgrammeCode("pain_knee")).toBe(true);
    expect(isMskProgrammeCode("panic_breathing")).toBe(false);
  });
});
