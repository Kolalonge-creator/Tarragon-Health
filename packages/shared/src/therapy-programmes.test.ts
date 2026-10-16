import { describe, expect, it } from "@jest/globals";
import {
  assessWorsening,
  evaluateEntryScreen,
  guidanceKeyForRoute,
  isCheckpoint,
  mayUploadDiary,
  therapyExclusionRules,
  therapyProgrammeConfig,
  THERAPY_PROGRAMME_CODES,
  validateScores,
  type TherapyAnswers,
  type TherapyExclusionRule,
  type TherapyProgrammeCode,
} from "./therapy-programmes";

/** Answers that are all clear for a list: every yes/no "no", every score just inside the clear side of its threshold. */
function clearAnswers(rules: readonly TherapyExclusionRule[]): Record<string, boolean | number> {
  const a: Record<string, boolean | number> = {};
  for (const r of rules) {
    if (r.kind === "yes_no") a[r.code] = false;
    else if (r.kind === "score_at_least") a[r.code] = (r.threshold as number) - 1;
    else a[r.code] = r.threshold as number; // score_below: at the threshold is clear
  }
  return a;
}
/** The one answer that makes this rule positive. */
function positiveValue(r: TherapyExclusionRule): boolean | number {
  if (r.kind === "yes_no") return true;
  if (r.kind === "score_at_least") return r.threshold as number;
  return (r.threshold as number) - 1;
}

describe("the entry screen is table-driven and fails closed", () => {
  for (const code of THERAPY_PROGRAMME_CODES) {
    const rules = therapyExclusionRules(code);
    if (rules.length === 0) continue;

    it(`${code}: all-clear answers pass`, () => {
      const r = evaluateEntryScreen(rules, clearAnswers(rules));
      expect(r.passed).toBe(true);
      expect(r.stops).toEqual([]);
      expect(r.route).toBeNull();
    });

    for (const rule of rules) {
      it(`${code}: ${rule.code} refuses enrolment and routes to ${rule.route}`, () => {
        const r = evaluateEntryScreen(rules, { ...clearAnswers(rules), [rule.code]: positiveValue(rule) });
        expect(r.passed).toBe(false);
        expect(r.stops.map((s) => s.code)).toEqual([rule.code]);
        expect(r.route).toBe(rule.route);
      });
      it(`${code}: ${rule.code} left unanswered refuses enrolment (fail closed)`, () => {
        const answers: Record<string, boolean | number> = { ...clearAnswers(rules) };
        delete answers[rule.code];
        const r = evaluateEntryScreen(rules, answers);
        expect(r.passed).toBe(false);
        expect(r.stops.find((s) => s.code === rule.code)?.unanswered).toBe(true);
      });
    }
  }

  it("a programme with no list admits nobody", () => {
    const r = evaluateEntryScreen(therapyExclusionRules("pulmonary_rehab"), { anything: false });
    expect(r.passed).toBe(false);
    expect(r.noRules).toBe(true);
    expect(guidanceKeyForRoute(r.route, r.noRules)).toBe("therapy.guidance.not_available");
  });

  it("null and undefined answers refuse, and a wrong kind of value refuses", () => {
    const rules = therapyExclusionRules("pelvic_floor");
    expect(evaluateEntryScreen(rules, null).passed).toBe(false);
    expect(evaluateEntryScreen(rules, undefined).passed).toBe(false);
    const wrongKind: TherapyAnswers = { ...clearAnswers(rules), blood_in_urine: 0 as unknown as boolean };
    expect(evaluateEntryScreen(rules, wrongKind).passed).toBe(false);
    const nan: TherapyAnswers = { ...clearAnswers(therapyExclusionRules("low_mood")), phq9_total: Number.NaN };
    expect(evaluateEntryScreen(therapyExclusionRules("low_mood"), nan).passed).toBe(false);
  });

  it("ACCEPTANCE: back pain with saddle numbness blocks enrolment and shows urgent guidance", () => {
    const rules = therapyExclusionRules("pain_back");
    const r = evaluateEntryScreen(rules, { ...clearAnswers(rules), saddle_numbness: true });
    expect(r.passed).toBe(false);
    expect(r.route).toBe("same_day_clinician");
    expect(guidanceKeyForRoute(r.route)).toBe("therapy.guidance.same_day_clinician");
  });

  it("the most urgent route wins when several stop the programme", () => {
    const rules = therapyExclusionRules("low_mood");
    const r = evaluateEntryScreen(rules, { phq9_item9: 1, phq9_total: 20, gad7_total: 3 });
    expect(r.stops.map((s) => s.route).sort()).toEqual(["crisis", "medical_review_first"]);
    expect(r.route).toBe("crisis");
  });

  it("ANY PHQ-9 item 9 above zero is a crisis stop, zero is not (Q15)", () => {
    const rules = therapyExclusionRules("low_mood");
    const base = { phq9_total: 10, gad7_total: 5 };
    expect(evaluateEntryScreen(rules, { ...base, phq9_item9: 0 }).passed).toBe(true);
    for (const v of [1, 2, 3]) expect(evaluateEntryScreen(rules, { ...base, phq9_item9: v }).route).toBe("crisis");
  });

  it("PHQ-9 and GAD-7 of 15 or more need clinician review first, 14 does not (Q15)", () => {
    const rules = therapyExclusionRules("anxiety");
    expect(evaluateEntryScreen(rules, { phq9_item9: 0, phq9_total: 14, gad7_total: 14 }).passed).toBe(true);
    expect(evaluateEntryScreen(rules, { phq9_item9: 0, phq9_total: 15, gad7_total: 5 }).route).toBe("medical_review_first");
    expect(evaluateEntryScreen(rules, { phq9_item9: 0, phq9_total: 5, gad7_total: 15 }).route).toBe("medical_review_first");
  });

  it("CBT-I: ISI 15 and above enters, 8 to 14 is education only, Epworth 10 and STOP-Bang 3 need medical review first (Q14)", () => {
    const rules = therapyExclusionRules("cbt_i");
    const clear = clearAnswers(rules);
    expect(evaluateEntryScreen(rules, { ...clear, isi_total: 15 }).passed).toBe(true);
    for (const isi of [8, 14]) expect(evaluateEntryScreen(rules, { ...clear, isi_total: isi }).route).toBe("education_only");
    expect(evaluateEntryScreen(rules, { ...clear, epworth_total: 9 }).passed).toBe(true);
    expect(evaluateEntryScreen(rules, { ...clear, epworth_total: 10 }).route).toBe("medical_review_first");
    expect(evaluateEntryScreen(rules, { ...clear, stopbang_total: 2 }).passed).toBe(true);
    expect(evaluateEntryScreen(rules, { ...clear, stopbang_total: 3 }).route).toBe("medical_review_first");
  });

  it("panic: first-time panic and any chest symptom never reach a session without a clinician first", () => {
    const rules = therapyExclusionRules("panic_breathing");
    const clear = clearAnswers(rules);
    expect(evaluateEntryScreen(rules, { ...clear, first_time_panic: true }).route).toBe("medical_review_first");
    expect(evaluateEntryScreen(rules, { ...clear, chest_symptom: true }).route).toBe("same_day_clinician");
  });

  it("pelvic floor and IBS carry the CMO list and mark only the local additions unverified", () => {
    const pelvic = therapyExclusionRules("pelvic_floor");
    expect(pelvic.filter((r) => r.unverified).map((r) => r.code)).toEqual(["continuous_leakage"]);
    const ibs = therapyExclusionRules("ibs_hypnotherapy");
    expect(ibs.filter((r) => r.unverified).map((r) => r.code).sort()).toEqual(["new_onset_over_50", "night_symptoms"]);
    for (const code of ["blood_in_urine", "urinary_retention", "pelvic_mass"]) expect(pelvic.find((r) => r.code === code)?.unverified).toBeUndefined();
  });

  it("a stop on an unverified item still stops the programme", () => {
    const rules = therapyExclusionRules("pelvic_floor");
    expect(evaluateEntryScreen(rules, { ...clearAnswers(rules), continuous_leakage: true }).passed).toBe(false);
  });
});

describe("guidance cards carry no phone number", () => {
  it("every route maps to a therapy.guidance key", () => {
    for (const route of ["crisis", "same_day_clinician", "medical_review_first", "education_only"] as const) {
      expect(guidanceKeyForRoute(route)).toBe(`therapy.guidance.${route}`);
    }
  });
});

describe("outcome scores and worsening", () => {
  const config = therapyProgrammeConfig();

  it("checkpoints start at session 1 (the baseline) for every programme that has any", () => {
    for (const code of THERAPY_PROGRAMME_CODES) {
      const cps = config.checkpoints[code];
      if (cps.length > 0) expect(cps[0]).toBe(1);
    }
  });

  it("validates scores: only the programme's own instruments, whole numbers in range, only at a checkpoint", () => {
    expect(validateScores("low_mood", 1, { phq9: 9, gad7: 7 })).toBeNull();
    expect(validateScores("low_mood", 2, { phq9: 9, gad7: 7 })).toBe("not_a_checkpoint");
    expect(validateScores("low_mood", 1, { phq9: 9 })).toBe("missing_instrument");
    expect(validateScores("low_mood", 1, { phq9: 9, gad7: 7, isi: 3 })).toBe("unknown_instrument");
    expect(validateScores("low_mood", 1, { phq9: 28, gad7: 7 })).toBe("out_of_range");
    expect(validateScores("low_mood", 1, { phq9: 9.5, gad7: 7 })).toBe("missing_instrument");
    expect(isCheckpoint("pelvic_floor", 12)).toBe(true);
    expect(isCheckpoint("pelvic_floor", 11)).toBe(false);
  });

  it("PHQ-9 up 5 or more, GAD-7 up 4 or more, or PHQ-9 of 20 or more raises a review (Q15)", () => {
    const w = config.worsening;
    expect(assessWorsening(w, { phq9: 10 }, { phq9: 14 })).toEqual([]);
    expect(assessWorsening(w, { phq9: 10 }, { phq9: 15 })).toEqual([{ instrument: "phq9", baseline: 10, latest: 15, basis: "rise" }]);
    expect(assessWorsening(w, { gad7: 8 }, { gad7: 11 })).toEqual([]);
    expect(assessWorsening(w, { gad7: 8 }, { gad7: 12 })).toHaveLength(1);
    expect(assessWorsening(w, { phq9: 18 }, { phq9: 20 })).toEqual([{ instrument: "phq9", baseline: 18, latest: 20, basis: "absolute" }]);
  });

  it("an improvement, a missing baseline or an instrument with no rule raises nothing", () => {
    const w = config.worsening;
    expect(assessWorsening(w, { phq9: 15 }, { phq9: 5 })).toEqual([]);
    expect(assessWorsening(w, {}, { gad7: 12 })).toEqual([]);
    expect(assessWorsening(w, { weird: 1 }, { weird: 9 })).toEqual([]);
  });

  it("CBT-I floor and sleep restriction setting are the CMO values (Q14)", () => {
    expect(config.cbt_i.time_in_bed_floor_minutes).toBe(330);
    expect(config.cbt_i.sleep_restriction_requires_clinician_flag).toBe(true);
    expect(config.cbt_i.default_variant).toEqual(["sleep_diary", "wind_down", "stimulus_control"]);
  });

  it("no programme reaches the player before the engine knows its instruments (every listed programme has an entry)", () => {
    for (const code of THERAPY_PROGRAMME_CODES as readonly TherapyProgrammeCode[]) {
      expect(config.instruments[code]).toBeDefined();
      expect(config.checkpoints[code]).toBeDefined();
    }
  });
});

describe("diary stays on the device unless the patient opts in", () => {
  it("only an explicit true allows an upload", () => {
    expect(mayUploadDiary(true)).toBe(true);
    expect(mayUploadDiary(false)).toBe(false);
    expect(mayUploadDiary(null)).toBe(false);
    expect(mayUploadDiary(undefined)).toBe(false);
  });
});
