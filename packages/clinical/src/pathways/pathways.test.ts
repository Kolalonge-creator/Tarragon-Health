import { describe, expect, it } from "@jest/globals";
import { BP_CARE_V3, grade as gradeBp } from "../index";
import { TITRATION_PLACEHOLDER } from "../titration-fixture";
import {
  ASTHMA_COPD_V1,
  CKD_V1,
  DIABETES_CARE_V1,
  HEART_FAILURE_V1,
  HTN_RTSL_NG_DRAFT,
  HTN_STEP_IDS,
  PATHWAY_DEFINITIONS,
  bpTargetFor,
  buildAsthmaFacts,
  buildCkdFacts,
  buildGlucoseFacts,
  buildHeartFailureFacts,
  classifyWeight,
  composeCardiometabolic,
  gradePathway,
  gradeSevereBp,
  loadBpPathwayConfig,
  loadCadenceConfig,
  loadDiabetesReportingConfig,
  pathwayByCode,
  reportHba1c,
  screenPrediabetes,
  timeInRange,
  urgencyOf,
  validateHomeBp,
  validatePathwayRuleSet,
  type ComponentResult,
  type PathwayFacts,
  type PathwayRuleSet,
} from "./index";
import { proposeTitration } from "../titration";
import type { TitrationInput } from "../titration-types";

const NOW = "2026-10-07T10:00:00Z";
const run = (facts: PathwayFacts, rs: PathwayRuleSet) => gradePathway({ facts, readingAt: NOW, now: NOW }, rs);

describe("asthma and COPD (Q11)", () => {
  const facts = (over: Partial<Parameters<typeof buildAsthmaFacts>[0]> = {}) =>
    buildAsthmaFacts({ relieverUseTimes: [], canistersLast12m: 0, cannotFinishSentence: false, noReliefFromReliever: false, peakFlow: null, peakFlowBest: null, spo2Pct: null, now: NOW, ...over });
  it("cannot finish a sentence, no relief, peak flow under half of best, or SpO2 under 92 is red and pages", () => {
    for (const over of [{ cannotFinishSentence: true }, { noReliefFromReliever: true }, { peakFlow: 240, peakFlowBest: 500 }, { spo2Pct: 91 }]) {
      const r = run(facts(over), ASTHMA_COPD_V1);
      expect(r.grade).toBe("red");
      expect(r.actions.some((a) => a.kind === "page_on_call")).toBe(true);
    }
  });
  it("peak flow exactly half of best, or SpO2 of 92, is not red; no oximeter never fires the SpO2 line", () => {
    expect(run(facts({ peakFlow: 250, peakFlowBest: 500 }), ASTHMA_COPD_V1).grade).not.toBe("red");
    expect(run(facts({ spo2Pct: 92 }), ASTHMA_COPD_V1).grade).not.toBe("red");
    expect(run(facts({ spo2Pct: null }), ASTHMA_COPD_V1).grade).toBe("green");
  });
  it("reliever use more than twice in 7 days, or three canisters in a year, is an amber review", () => {
    const three = ["2026-10-06T08:00:00Z", "2026-10-05T08:00:00Z", "2026-10-04T08:00:00Z"];
    expect(run(facts({ relieverUseTimes: three }), ASTHMA_COPD_V1).grade).toBe("amber");
    expect(run(facts({ relieverUseTimes: three.slice(0, 2) }), ASTHMA_COPD_V1).grade).toBe("green");
    expect(run(facts({ canistersLast12m: 3 }), ASTHMA_COPD_V1).grade).toBe("amber");
    // uses older than 7 days do not count
    expect(run(facts({ relieverUseTimes: ["2026-09-01T08:00:00Z", "2026-09-02T08:00:00Z", "2026-09-03T08:00:00Z"] }), ASTHMA_COPD_V1).grade).toBe("green");
  });
});

describe("heart failure (Q12): weight up more than 2 kg in 3 days", () => {
  const g = (latest: number, history: [number, string][]) =>
    run(buildHeartFailureFacts({ kg: latest, at: NOW }, history.map(([kg, at]) => ({ kg, at })), NOW), HEART_FAILURE_V1);
  it("flags above 2 kg, not at 2 kg exactly, and ignores readings older than 3 days", () => {
    expect(g(82.5, [[80, "2026-10-05T10:00:00Z"]]).grade).toBe("amber");
    expect(g(82, [[80, "2026-10-05T10:00:00Z"]]).grade).toBe("green");
    expect(g(85, [[80, "2026-09-20T10:00:00Z"]]).grade).toBe("green");
  });
  it("one weight with no earlier one is not graded (no fact, no rule)", () => {
    expect(run(buildHeartFailureFacts({ kg: 80, at: NOW }, [], NOW), HEART_FAILURE_V1).matchedRuleIds).toEqual([]);
  });
});

describe("CKD (Q12): refer on eGFR under 30, ACR 300 or more, a fall over 20% or 5 mL/min in a year, or refractory hypertension", () => {
  const g = (over: Partial<Parameters<typeof buildCkdFacts>[0]>) =>
    run(buildCkdFacts({ egfr: 60, acrMgPerG: 10, egfrHistory: [], refractoryHypertension: false, now: NOW, ...over }), CKD_V1);
  it("each trigger alone refers and creates a review task and a referral route", () => {
    for (const over of [{ egfr: 29 }, { acrMgPerG: 300 }, { refractoryHypertension: true }, { egfr: 50, egfrHistory: [{ value: 66, at: "2026-03-01T00:00:00Z" }] }, { egfr: 58, egfrHistory: [{ value: 64, at: "2026-03-01T00:00:00Z" }] }]) {
      const r = g(over);
      expect(r.grade).toBe("amber");
      expect(r.actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["route_referral", "create_task"]));
    }
  });
  it("30 exactly, ACR 299 and a small fall do not refer; a fall older than a year does not count", () => {
    expect(g({ egfr: 30 }).grade).toBe("green");
    expect(g({ acrMgPerG: 299 }).grade).toBe("green");
    expect(g({ egfr: 58, egfrHistory: [{ value: 60, at: "2026-03-01T00:00:00Z" }] }).grade).toBe("green");
    expect(g({ egfr: 40, egfrHistory: [{ value: 90, at: "2024-01-01T00:00:00Z" }] }).grade).toBe("green");
  });
});

describe("the other pathway rule sets are drafts, valid, never name a medicine and every red pages", () => {
  for (const rs of [DIABETES_CARE_V1, ASTHMA_COPD_V1, HEART_FAILURE_V1, CKD_V1]) {
    it(rs.code, () => {
      expect(rs.status).toBe("draft");
      expect(validatePathwayRuleSet(rs)).toEqual([]);
      expect(JSON.stringify(rs)).not.toMatch(/\bdose\b|titrat|prescri|\bmg\b/i);
      for (const r of rs.rules.filter((x) => x.grade === "red")) expect(r.actions.some((a) => a.kind === "page_on_call")).toBe(true);
    });
  }
});

describe("cardiometabolic composition (Q9): run each rule set, most urgent wins", () => {
  const comp = (source: string, grade: "green" | "amber" | "red" | null, status: ComponentResult["status"] = "graded", actions: ComponentResult["actions"] = []): ComponentResult =>
    ({ source, status, grade, ruleId: `${source}-rule`, explanationKey: `${source}-key`, actions });

  it("a red diabetes result wins over a green blood pressure result and keeps its page", () => {
    const d = gradePathway({ facts: buildGlucoseFacts({ latest: { mmol: 2.8, takenAt: NOW, events: ["confusion"] }, history: [], ketoneMmol: null, ketoneUrine: null, insulinOrSulfonylurea: null, now: NOW }), readingAt: NOW, now: NOW }, DIABETES_CARE_V1);
    const bp = gradeBp({ trigger: { type: "observation", reading: { systolic: 124, diastolic: 78, takenAt: NOW }, symptoms: [] }, history: [], target: { systolic: 130, diastolic: 80 }, pathway: { state: "care_pack_active" }, pregnant: false, ageYears: 50, now: NOW }, BP_CARE_V3);
    const composed = composeCardiometabolic([{ source: "bp", ...bp }, { source: "diabetes_care", ...d }]);
    expect(composed.grade).toBe("red");
    expect(composed.winnerSource).toBe("diabetes_care");
    expect(composed.actions.some((a) => a.kind === "page_on_call")).toBe(true);
  });

  it("empty, rejected and pending components behave", () => {
    expect(composeCardiometabolic([]).grade).toBeNull();
    expect(composeCardiometabolic([comp("a", null, "rejected")]).winnerSource).toBeNull();
    const pending = composeCardiometabolic([comp("a", null, "recheck_required"), comp("b", "green")]);
    expect(pending.status).toBe("recheck_required");
    expect(pending.grade).toBeNull();
    expect(urgencyOf(comp("a", null, "symptom_check_required"))).toBe(1.5);
    expect(urgencyOf(comp("a", null))).toBe(0);
  });

  it("de-duplicates identical actions across components at the winning urgency", () => {
    const page = [{ kind: "page_on_call" }];
    const c = composeCardiometabolic([comp("a", "red", "graded", page), comp("b", "red", "graded", page)]);
    expect(c.actions).toEqual(page);
    expect(c.componentSources).toEqual(["a", "b"]);
  });

  it("PROPERTY: adding any extra component never lowers the urgency, whatever its grade or status", () => {
    const states: ComponentResult[] = [
      comp("g", "green"), comp("a", "amber"), comp("r", "red"), comp("p", null, "recheck_required"), comp("x", null, "rejected"), comp("s", null, "symptom_check_required"),
    ];
    for (const base of states) {
      for (const extra of states) {
        const alone = composeCardiometabolic([base]).urgency;
        const together = composeCardiometabolic([base, extra]).urgency;
        const reversed = composeCardiometabolic([extra, base]).urgency;
        expect(together).toBeGreaterThanOrEqual(alone);
        expect(reversed).toBe(together);
        for (const third of states) expect(composeCardiometabolic([base, extra, third]).urgency).toBeGreaterThanOrEqual(together);
      }
    }
  });
});

describe("diabetes reporting (Q7): reporting only", () => {
  it("time in range, below range and below 3.0 against the targets", () => {
    const good = timeInRange([...Array(80).fill({ mmol: 6 }), ...Array(19).fill({ mmol: 11 }), { mmol: 3.5 }]);
    expect(good.inRangePct).toBe(80);
    expect(good.inRangeMeetsTarget).toBe(true);
    expect(good.belowRangeWithinLimit).toBe(true); // 1% below 3.9
    const bad = timeInRange([...Array(90).fill({ mmol: 6 }), ...Array(5).fill({ mmol: 3.5 }), ...Array(5).fill({ mmol: 2.5 })]);
    expect(bad.belowRangeWithinLimit).toBe(false);
    expect(bad.belowLowRangeWithinLimit).toBe(false);
    expect(timeInRange([]).inRangePct).toBeNull();
  });
  it("exactly 70% in range does not meet 'above 70'", () => {
    expect(timeInRange([...Array(70).fill({ mmol: 6 }), ...Array(30).fill({ mmol: 12 })]).inRangeMeetsTarget).toBe(false);
  });
  it("HbA1c: under 7 on target, 7 to under 8 above target, 8 or more flags a review, an individual target is honoured", () => {
    expect(reportHba1c(6.8).state).toBe("at_or_below_target");
    expect(reportHba1c(7.4).state).toBe("above_target");
    expect(reportHba1c(8).state).toBe("review_flagged");
    expect(reportHba1c(7.4, 8).state).toBe("at_or_below_target");
    expect(reportHba1c(null).state).toBe("no_value");
  });
  it("prediabetes is a screening label, never a diagnosis (ADA 5.6 to 6.9 fasting, 5.7 to 6.4 HbA1c)", () => {
    expect(screenPrediabetes({ fastingMmol: 5.5, hba1cPct: 5.4 }).label).toBe("screening_not_in_range");
    expect(screenPrediabetes({ fastingMmol: 5.6, hba1cPct: null }).label).toBe("screening_prediabetes_range");
    expect(screenPrediabetes({ fastingMmol: null, hba1cPct: 6.4 }).label).toBe("screening_prediabetes_range");
    expect(screenPrediabetes({ fastingMmol: 7.0, hba1cPct: null }).label).toBe("screening_diabetes_range");
    expect(screenPrediabetes({ fastingMmol: 6.0, hba1cPct: 6.5 })).toEqual({ label: "screening_diabetes_range", basis: ["fasting", "hba1c"] });
    expect(screenPrediabetes({ fastingMmol: null, hba1cPct: null }).label).toBe("no_value");
    for (const label of ["screening_not_in_range", "screening_prediabetes_range", "screening_diabetes_range"]) expect(label).toMatch(/^screening_/);
    expect(loadDiabetesReportingConfig().value.prediabetesFastingMinMmol).toBe(5.6);
  });
});

describe("weight (Q10)", () => {
  it("BMI 25 and 30, waist-to-height 0.5 and 0.6, and unknowns", () => {
    expect(classifyWeight({ weightKg: 72, heightCm: 170 }).bmiBand).toBe("below_overweight");
    expect(classifyWeight({ weightKg: 72.3, heightCm: 170 }).bmiBand).toBe("overweight");
    expect(classifyWeight({ weightKg: 90, heightCm: 170 }).bmiBand).toBe("obese");
    expect(classifyWeight({ weightKg: 70, heightCm: 170, waistCm: 85 }).waistToHeightFlag).toBe("raised");
    expect(classifyWeight({ weightKg: 70, heightCm: 170, waistCm: 110 }).waistToHeightFlag).toBe("high");
    expect(classifyWeight({ weightKg: 70, heightCm: 170, waistCm: 80 }).waistToHeightFlag).toBe("not_raised");
    expect(classifyWeight({ weightKg: null, heightCm: 170 })).toMatchObject({ bmi: null, bmiBand: "unknown", waistToHeightFlag: "unknown" });
  });
});

describe("hypertension pathway rules (Q2, Q3, Q4)", () => {
  it("Q2 targets: 140/90 by default, 130/80 with CVD, diabetes or CKD", () => {
    expect(bpTargetFor({ hasCvd: false, hasDiabetes: false, hasCkd: false })).toEqual({ systolic: 140, diastolic: 90 });
    for (const v of [{ hasCvd: true, hasDiabetes: false, hasCkd: false }, { hasCvd: false, hasDiabetes: true, hasCkd: false }, { hasCvd: false, hasDiabetes: false, hasCkd: true }]) {
      expect(bpTargetFor(v)).toEqual({ systolic: 130, diastolic: 80 });
    }
  });
  it("Q3: 180/110 with no symptom is amber; with a warning symptom red; unanswered is red; below the line is none", () => {
    expect(gradeSevereBp({ systolic: 182, diastolic: 100, symptoms: [] }).tier).toBe("amber");
    expect(gradeSevereBp({ systolic: 150, diastolic: 112, symptoms: [] }).tier).toBe("amber");
    for (const s of loadBpPathwayConfig().value.severeSymptoms) expect(gradeSevereBp({ systolic: 190, diastolic: 100, symptoms: [s] }).tier).toBe("red");
    expect(gradeSevereBp({ systolic: 190, diastolic: 100, symptoms: ["dizziness"] }).tier).toBe("amber");
    expect(gradeSevereBp({ systolic: 190, diastolic: 100, symptoms: null }).tier).toBe("red");
    expect(gradeSevereBp({ systolic: 179, diastolic: 109, symptoms: ["chest_pain"] }).tier).toBe("none");
  });
  const day = (d: number, h: number, s: number, dia: number, session: "morning" | "evening") => ({ systolic: s, diastolic: dia, takenAt: `2026-10-0${d}T0${h}:00:00Z`, session });
  const week = (s: number, dia: number) => [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [day(d, 7, s, dia, "morning"), day(d, 8, s, dia, "morning"), day(d, 9, s, dia, "evening")]);
  it("Q4: seven days with the first day discarded; a mean of 135/85 or more is raised", () => {
    const high = validateHomeBp(week(138, 84));
    expect(high).toMatchObject({ valid: true, raised: true, daysUsed: 6 });
    const ok = validateHomeBp(week(130, 80));
    expect(ok).toMatchObject({ valid: true, raised: false });
    expect(validateHomeBp(week(135, 70))).toMatchObject({ raised: true });
    expect(validateHomeBp(week(130, 85))).toMatchObject({ raised: true });
  });
  it("Q4: the discarded first day really is discarded, and a thin week is not averaged", () => {
    const readings = [...week(130, 80).map((r) => (r.takenAt.startsWith("2026-10-01") ? { ...r, systolic: 200 } : r))];
    expect(validateHomeBp(readings)).toMatchObject({ valid: true, meanSystolic: 130 });
    expect(validateHomeBp(week(130, 80).slice(0, 9))).toEqual({ valid: false, reason: "too_few_days" });
    expect(validateHomeBp([])).toEqual({ valid: false, reason: "no_readings" });
  });
});

describe("the DRAFT hypertension step table (Q1 option A)", () => {
  it("is a draft with the ladder order, never approved by an agent", () => {
    expect(HTN_RTSL_NG_DRAFT.status).toBe("draft");
    expect(HTN_STEP_IDS).toEqual(["step_1_amlodipine_5", "step_2_add_losartan_50", "step_3a_raise_amlodipine_10", "step_3b_raise_losartan_100", "step_4_add_hctz_25", "step_5_refer"]);
  });

  const reading = (i: number) => ({ systolic: 158, diastolic: 98, takenAt: new Date(Date.parse(NOW) - i * 3_600_000 * 20).toISOString(), validated: true });
  const med = (id: string, drugName: string, dose: string) => ({ id, drugName, dose, frequency: "once daily", startedAt: "2026-08-01T00:00:00Z", clinicianIssued: true });
  const input = (over: Partial<TitrationInput>): TitrationInput => ({
    now: NOW, isTest: true, patient: { ageYears: 52, pregnancy: "no" }, target: { systolic: 140, diastolic: 90 }, readings: [1, 2, 3, 4, 5].map(reading),
    currentMedications: [], adherencePercent: 95, openTriage: "none", sideEffectsReported: false, lastChangeAt: null, ...over,
  });
  const next = (meds: ReturnType<typeof med>[], over: Partial<TitrationInput> = {}) => proposeTitration(input({ currentMedications: meds, ...over }), HTN_RTSL_NG_DRAFT);

  it("walks the ladder one signed change at a time for a test patient", () => {
    const steps: [ReturnType<typeof med>[], string][] = [
      [[], "step_1_amlodipine_5"],
      [[med("a", "Amlodipine", "5 mg")], "step_2_add_losartan_50"],
      [[med("a", "Amlodipine", "5 mg"), med("b", "Losartan", "50 mg")], "step_3a_raise_amlodipine_10"],
      [[med("a", "Amlodipine", "10 mg"), med("b", "Losartan", "50 mg")], "step_3b_raise_losartan_100"],
      [[med("a", "Amlodipine", "10 mg"), med("b", "Losartan", "100 mg")], "step_4_add_hctz_25"],
    ];
    for (const [meds, stepId] of steps) {
      const r = next(meds);
      expect(r.kind).toBe("proposal");
      if (r.kind === "proposal") expect(r.stepId).toBe(stepId);
    }
  });

  it("the final step refers: no proposal", () => {
    const r = next([med("a", "Amlodipine", "10 mg"), med("b", "Losartan", "100 mg"), med("c", "Hydrochlorothiazide", "25 mg")]);
    expect(r.kind).toBe("no_proposal");
    if (r.kind === "no_proposal") expect(r.reasons.map((x) => x.code)).toContain("final_step_reached");
  });

  it("a draft table can NEVER propose for a real patient (INV-02: agents do not approve)", () => {
    const r = next([], { isTest: false });
    expect(r.kind).toBe("no_proposal");
    if (r.kind === "no_proposal") expect(r.reasons.map((x) => x.code)).toContain("protocol_not_approved_for_real_patient");
  });

  it("anyone who could be pregnant gets no proposal, so no ARB step can fire", () => {
    for (const pregnancy of ["yes", "unknown"] as const) {
      const r = next([med("a", "Amlodipine", "5 mg")], { patient: { ageYears: 30, pregnancy } });
      expect(r.kind).toBe("no_proposal");
    }
  });

  it("a change inside the monthly review window blocks the next step", () => {
    const r = next([med("a", "Amlodipine", "5 mg")], { lastChangeAt: "2026-09-25T00:00:00Z" });
    expect(r.kind).toBe("no_proposal");
    if (r.kind === "no_proposal") expect(r.reasons.map((x) => x.code)).toContain("change_inside_review_window");
  });

  it("replaces the fictional fixture only as a draft: no fixture drug appears and no insulin or non-antihypertensive drug is named", () => {
    const names = HTN_RTSL_NG_DRAFT.steps.flatMap((s) => (s.propose ? [s.propose.item.drugName] : []));
    expect(names).toEqual(["Amlodipine", "Losartan", "Amlodipine", "Losartan", "Hydrochlorothiazide"]);
    expect(JSON.stringify(HTN_RTSL_NG_DRAFT)).not.toMatch(/TestDrug|insulin/i);
    expect(JSON.stringify(TITRATION_PLACEHOLDER)).toMatch(/TestDrug/);
  });
});

describe("registry (S62)", () => {
  it("every pathway has a guard key pathway_<code>, unique", () => {
    const keys = PATHWAY_DEFINITIONS.map((p) => p.guardKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PATHWAY_DEFINITIONS) expect(p.guardKey).toBe(`pathway_${p.code}`);
  });
  it("sickle cell and post-stroke are scaffolds with no rule set and no step table (Q12: thresholds deferred)", () => {
    for (const code of ["sickle_cell_care", "post_stroke_care"]) {
      const p = pathwayByCode(code)!;
      expect(p).toMatchObject({ kind: "scaffold", ruleSetCode: null, stepTableCode: null, programmeCodes: [] });
    }
  });
  it("cardiometabolic composes bp and diabetes and has no rule set of its own; diabetes has no step table (Q8)", () => {
    expect(pathwayByCode("cardiometabolic_care")).toMatchObject({ kind: "composite", composedOf: ["bp", "diabetes_care"], ruleSetCode: null });
    expect(pathwayByCode("diabetes_care")!.stepTableCode).toBeNull();
    expect(pathwayByCode("bp")!.stepTableCode).toBe(HTN_RTSL_NG_DRAFT.code);
  });
  it("prediabetes and weight are reporting only and grade nothing", () => {
    for (const code of ["prediabetes_prevention", "weight_care"]) expect(pathwayByCode(code)).toMatchObject({ reportingOnly: true, ruleSetCode: null });
  });
  it("cadence config: weekly automated review, monthly clinician review while uncontrolled, quarterly when controlled", () => {
    const c = loadCadenceConfig().value;
    expect([c.automatedReviewDays, c.clinicianReviewUncontrolledDays, c.clinicianReviewControlledDays]).toEqual([7, 30, 90]);
  });
});
