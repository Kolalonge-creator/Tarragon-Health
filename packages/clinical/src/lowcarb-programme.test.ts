import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "@tarragon/shared";
import {
  classifyLowCarbReading,
  coarsenLowCarbReasons,
  lowCarbCheckins,
  lowCarbConditionMatches,
  lowCarbEligibility,
  lowCarbMedicineMatches,
  lowCarbProposalToChangeArgs,
  lowCarbStopCheck,
  parseLowCarbGate,
  proposeLowCarbMedicineReview,
  unavailableLowCarbGate,
  type LowCarbConfig,
  type LowCarbEligibilityInput,
  type LowCarbReviewInput,
  type LowCarbStepTable,
} from "./lowcarb-programme";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const config = getProposedConfig("lowcarb.protocol_rules").value as unknown as LowCarbConfig;
const table = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "lowcarb-step-table.json"), "utf8")) as LowCarbStepTable;

const NOW = "2026-10-21T12:00:00Z";
const daysAgo = (d: number): string => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const hoursAgo = (h: number): string => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();

const base: LowCarbEligibilityInput = {
  now: NOW,
  ageYears: 50,
  diabetesType: { confirmed: "type_2", reported: null },
  pregnancy: "no",
  eatingDisorderScreenPositive: false,
  conditions: [],
  medicines: [],
  glucoseReadings: [],
  triageEvents: [],
  confirmations: { noRecentAdmission: true, supervisionAccepted: false },
};
const elig = (p: Partial<LowCarbEligibilityInput> = {}): string => {
  const r = lowCarbEligibility({ ...base, ...p }, config);
  return `${r.decision}|${[...r.reasons].sort().join(",")}`;
};

/** Case ids L01..L26 are shared with packages/db/tests/s50b_lowcarb_t2d_programme.sql (lowcarb-parity.test.ts pins them). */
const CASES: { id: string; input: Partial<LowCarbEligibilityInput>; expected: string }[] = [
  { id: "L01", input: {}, expected: "eligible|none" },
  { id: "L02", input: { ageYears: 17 }, expected: "not_eligible|under_age" },
  { id: "L03", input: { ageYears: null }, expected: "not_eligible|age_unknown" },
  { id: "L04", input: { diabetesType: { confirmed: "type_1", reported: null } }, expected: "not_eligible|not_type_2" },
  { id: "L05", input: { diabetesType: { confirmed: null, reported: "type_2" } }, expected: "not_eligible|type_unconfirmed" },
  { id: "L06", input: { pregnancy: "yes" }, expected: "not_eligible|pregnancy_or_postnatal" },
  { id: "L07", input: { eatingDisorderScreenPositive: true }, expected: "not_eligible|eating_disorder_screen" },
  { id: "L08", input: { conditions: [{ name: "Chronic kidney disease stage 3", icd10: null, status: "active" }] }, expected: "not_eligible|condition_kidney_disease" },
  { id: "L09", input: { conditions: [{ name: "Chronic kidney disease", icd10: null, status: "resolved" }] }, expected: "eligible|none" },
  { id: "L10", input: { conditions: [{ name: "Reduced function", icd10: "N18.3", status: "active" }] }, expected: "not_eligible|condition_kidney_disease" },
  { id: "L11", input: { medicines: ["Jardiance 10mg"] }, expected: "not_eligible|medicine_sglt2_inhibitor" },
  { id: "L12", input: { medicines: ["Insulin glargine"] }, expected: "needs_supervision|supervision_insulin" },
  { id: "L13", input: { medicines: ["Insulin glargine"], confirmations: { noRecentAdmission: true, supervisionAccepted: true } }, expected: "eligible|none" },
  { id: "L14", input: { medicines: ["Gliclazide 80mg"] }, expected: "needs_supervision|supervision_sulfonylurea" },
  { id: "L15", input: { glucoseReadings: [{ mmol: 2.5, at: daysAgo(10) }] }, expected: "not_eligible|recent_severe_low_sugar" },
  { id: "L16", input: { glucoseReadings: [{ mmol: 2.5, at: daysAgo(100) }] }, expected: "eligible|none" },
  { id: "L17", input: { glucoseReadings: [{ mmol: 3.5, at: daysAgo(10) }] }, expected: "eligible|none" },
  { id: "L18", input: { confirmations: { noRecentAdmission: false, supervisionAccepted: false } }, expected: "not_eligible|admission_not_ruled_out" },
  { id: "L19", input: { triageEvents: [{ grade: "red", at: hoursAgo(24) }] }, expected: "not_now|recent_triage_event" },
  { id: "L20", input: { triageEvents: [{ grade: "amber", at: hoursAgo(100) }] }, expected: "eligible|none" },
  { id: "L21", input: { diabetesType: { confirmed: "type_1", reported: null }, pregnancy: "yes" }, expected: "not_eligible|not_type_2,pregnancy_or_postnatal" },
  { id: "L22", input: { pregnancy: "yes", medicines: ["Insulin glargine"] }, expected: "not_eligible|pregnancy_or_postnatal" },
  { id: "L24", input: { triageEvents: [{ grade: "green", at: hoursAgo(2) }] }, expected: "eligible|none" },
  { id: "L25", input: { pregnancy: "yes" }, expected: "not_eligible|pregnancy_or_postnatal" },
  { id: "L26", input: { pregnancy: "no" }, expected: "eligible|none" },
];

describe("low-carbohydrate eligibility", () => {
  it.each(CASES)("$id", ({ input, expected }) => {
    expect(elig(input)).toBe(expected);
  });

  it("L23: no signed rules is unavailable, never eligible", () => {
    expect(lowCarbEligibility(base, null)).toEqual({ decision: "unavailable", reasons: ["rules_unavailable"], supervisionFor: [] });
  });

  it("an unreadable clock is unavailable", () => {
    expect(lowCarbEligibility({ ...base, now: "not a date" }, config).decision).toBe("unavailable");
  });

  it("an unreadable pregnancy record refuses", () => {
    expect(elig({ pregnancy: "unknown" })).toBe("not_eligible|pregnancy_unknown");
  });

  it("when type 2 need not be confirmed, a reported type 1 still refuses and a reported type 2 passes", () => {
    const loose = { ...config, eligibility: { ...config.eligibility, require_confirmed_type_2: false } };
    expect(lowCarbEligibility({ ...base, diabetesType: { confirmed: null, reported: "type_1" } }, loose).reasons).toEqual(["not_type_2"]);
    expect(lowCarbEligibility({ ...base, diabetesType: { confirmed: null, reported: "type_2" } }, loose).decision).toBe("eligible");
    expect(lowCarbEligibility({ ...base, diabetesType: { confirmed: null, reported: null } }, loose).decision).toBe("eligible");
  });

  it("a hypo reading dated in the future does not count", () => {
    expect(elig({ glucoseReadings: [{ mmol: 2.0, at: daysAgo(-2) }] })).toBe("eligible|none");
  });

  it("a triage event dated in the future does not count", () => {
    expect(elig({ triageEvents: [{ grade: "red", at: hoursAgo(-5) }] })).toBe("eligible|none");
  });

  it("an empty pattern never matches everything", () => {
    expect(lowCarbConditionMatches([{ name: "anything", icd10: null, status: "active" }], { name_patterns: [""], icd10_prefixes: [] })).toBe(false);
    expect(lowCarbMedicineMatches(["anything"], [""])).toBe(false);
  });

  it("every exclusion in the config is a real list, and every medicine group has a known handling", () => {
    for (const m of Object.values(config.eligibility.condition_exclusions)) expect(Array.isArray(m.name_patterns)).toBe(true);
    for (const g of Object.values(config.eligibility.medicine_groups)) expect(["supervision", "exclude"]).toContain(g.handling);
  });

  it("insulin and a sulfonylurea both need supervision, and an SGLT2 inhibitor is excluded (CMO to confirm)", () => {
    expect(config.eligibility.medicine_groups.insulin?.handling).toBe("supervision");
    expect(config.eligibility.medicine_groups.sulfonylurea?.handling).toBe("supervision");
    expect(config.eligibility.medicine_groups.sglt2_inhibitor?.handling).toBe("exclude");
  });
});

describe("what a clinician without reproductive-health access is shown", () => {
  it("replaces a pregnancy reason with a coarse one and keeps the rest, once", () => {
    expect(coarsenLowCarbReasons(["pregnancy_or_postnatal", "pregnancy_unknown", "under_age"], false)).toEqual(["health_condition", "under_age"]);
  });
  it("shows it to a clinician the category-scoped path entitles", () => {
    expect(coarsenLowCarbReasons(["pregnancy_or_postnatal", "under_age"], true)).toEqual(["pregnancy_or_postnatal", "under_age"]);
  });
});

describe("the patient door", () => {
  it("accepts only an exact ok", () => {
    expect(parseLowCarbGate({ state: "ok", extra: 1 })).toEqual({ state: "ok" });
  });
  it.each([[null], ["ok"], [42], [{}], [{ state: "OK" }], [{ state: "unavailable" }]])("anything else is unavailable: %p", (v) => {
    expect(parseLowCarbGate(v)).toEqual({ state: "unavailable" });
  });
  it("what a client shows when it could not ask is the same answer", () => {
    expect(unavailableLowCarbGate()).toEqual({ state: "unavailable" });
  });
});

describe("reading classification (pause and review lines)", () => {
  it("a low glucose pauses", () => expect(classifyLowCarbReading({ metric: "glucose", value: 3.8 }, config)).toEqual({ action: "pause", code: "low_glucose" }));
  it("the line itself does not pause but is a low-normal review", () =>
    expect(classifyLowCarbReading({ metric: "glucose", value: 3.9 }, config)).toEqual({ action: "review", code: "low_normal_glucose" }));
  it("a normal glucose does nothing", () => expect(classifyLowCarbReading({ metric: "glucose", value: 6.0 }, config).action).toBe("none"));
  it("high ketones pause", () => expect(classifyLowCarbReading({ metric: "ketones", value: 3.0 }, config)).toEqual({ action: "pause", code: "high_ketones" }));
  it("ordinary ketones do nothing", () => expect(classifyLowCarbReading({ metric: "ketones", value: 1.2 }, config).action).toBe("none"));
  it("weight never pauses", () => expect(classifyLowCarbReading({ metric: "weight", value: 80 }, config).action).toBe("none"));
});

describe("stop rules", () => {
  it("three pauses in 30 days stop the programme", () =>
    expect(lowCarbStopCheck({ now: NOW, pausesLast30Days: 3, lastCheckinAt: daysAgo(1), activeSince: daysAgo(30) }, config)).toEqual({ stop: true, reason: "repeated_pauses" }));
  it("a long silence stops it", () =>
    expect(lowCarbStopCheck({ now: NOW, pausesLast30Days: 0, lastCheckinAt: daysAgo(15), activeSince: daysAgo(40) }, config)).toEqual({ stop: true, reason: "check_ins_lapsed" }));
  it("no check-in since enrolment counts from the start", () =>
    expect(lowCarbStopCheck({ now: NOW, pausesLast30Days: 0, lastCheckinAt: null, activeSince: daysAgo(20) }, config).reason).toBe("check_ins_lapsed"));
  it("an active person keeps going", () =>
    expect(lowCarbStopCheck({ now: NOW, pausesLast30Days: 1, lastCheckinAt: daysAgo(1), activeSince: daysAgo(40) }, config)).toEqual({ stop: false, reason: null }));
});

describe("check-ins", () => {
  const rd = (metric: "glucose" | "ketones" | "weight", d: number) => ({ metric, at: daysAgo(d) });
  it("no readings at all is overdue for all three", () => {
    const out = lowCarbCheckins({ now: NOW, readings: [] }, config);
    expect(out.map((l) => l.status)).toEqual(["overdue", "overdue", "overdue"]);
    expect(out.map((l) => l.lastAt)).toEqual([null, null, null]);
  });
  it("on track when the week's count is met and the last one is recent", () => {
    const readings = [...Array.from({ length: 14 }, (_, i) => rd("glucose", i * 0.4)), ...[0.5, 2, 3].map((d) => rd("ketones", d)), rd("weight", 1)];
    const out = lowCarbCheckins({ now: NOW, readings }, config);
    expect(out.map((l) => l.status)).toEqual(["on_track", "on_track", "on_track"]);
  });
  it("due when recent but short of the week's count", () => {
    const out = lowCarbCheckins({ now: NOW, readings: [rd("glucose", 0.2), rd("ketones", 1), rd("weight", 1)] }, config);
    expect(out[0]).toMatchObject({ metric: "glucose", status: "due", countThisWeek: 1, expected: 14 });
    expect(out[2]?.status).toBe("on_track");
  });
  it("overdue when the newest is older than the allowed gap, and a future reading is ignored", () => {
    const out = lowCarbCheckins({ now: NOW, readings: [rd("glucose", 3), rd("glucose", -1)] }, config);
    expect(out[0]?.status).toBe("overdue");
    expect(out[0]?.countThisWeek).toBe(1);
  });
});

describe("medicine review: the platform only proposes", () => {
  const med = (id: string, drugName: string, clinicianIssued = true) => ({ id, drugName, dose: "80mg", frequency: "daily", clinicianIssued });
  const reading = (mmol: number, d: number) => ({ mmol, at: daysAgo(d) });
  const falling = [reading(6.0, 1), reading(6.2, 2), reading(5.8, 3), reading(6.5, 4), reading(6.1, 5)];
  const input = (p: Partial<LowCarbReviewInput> = {}): LowCarbReviewInput => ({
    now: NOW,
    isTest: true,
    programmeActive: true,
    pregnancy: "no",
    openTriage: "none",
    glucose: falling,
    medicines: [med("m1", "Gliclazide"), med("m2", "Lantus insulin"), med("m3", "Metformin")],
    lastMedicineReviewAt: daysAgo(1),
    ...p,
  });

  it("the placeholder table is a draft and says so", () => {
    expect(table.status).toBe("draft");
    expect(table.placeholder).toBe(true);
    expect(table.code).toBe("t2d_lowcarb_deprescribing");
  });

  it("sugars falling gives a review note for the sulfonylurea and insulin, and nothing for metformin", () => {
    const r = proposeLowCarbMedicineReview(input(), table, config);
    expect(r.kind).toBe("review");
    if (r.kind !== "review") return;
    expect(r.triggers).toEqual(["average_glucose_low"]);
    expect(r.proposals.map((p) => `${p.stepId}:${p.drugName}:${p.action}:${p.proposable}`)).toEqual([
      "su_review_on_fall:Gliclazide:review_dose:false",
      "insulin_review_on_fall:Lantus insulin:review_dose:false",
    ]);
    expect(r.readingCount).toBe(5);
    expect(r.averageGlucose).toBe(6.1);
  });

  it("a low reading on a sulfonylurea proposes a stop, only for a clinician-issued medicine", () => {
    const g = [...falling, reading(3.6, 0.5)];
    const r = proposeLowCarbMedicineReview(input({ glucose: g }), table, config);
    expect(r.kind).toBe("review");
    if (r.kind !== "review") return;
    const stop = r.proposals.find((p) => p.stepId === "su_stop_on_low");
    expect(stop).toMatchObject({ action: "stop", medicationId: "m1", proposable: true });
    expect(r.triggers).toContain("a_low_reading");
    const patientAdded = proposeLowCarbMedicineReview(input({ glucose: g, medicines: [med("m9", "Daonil", false)] }), table, config);
    expect(patientAdded.kind === "review" && patientAdded.proposals.find((p) => p.stepId === "su_stop_on_low")?.proposable).toBe(false);
  });

  it("the standing review alone raises a review with no proposal when sugars are fine", () => {
    const r = proposeLowCarbMedicineReview(input({ glucose: [reading(9, 1), reading(9, 2), reading(9, 3), reading(9, 4), reading(9, 5)], lastMedicineReviewAt: daysAgo(20) }), table, config);
    expect(r).toMatchObject({ kind: "review", triggers: ["standing_review_due"], proposals: [] });
  });

  it("never having reviewed counts as due", () => {
    const r = proposeLowCarbMedicineReview(input({ glucose: [], lastMedicineReviewAt: null }), table, config);
    expect(r).toMatchObject({ kind: "review", triggers: ["standing_review_due"], averageGlucose: null, readingCount: 0 });
  });

  it("too few readings and no trigger give a reason, never silence", () => {
    expect(proposeLowCarbMedicineReview(input({ glucose: [reading(6, 1)] }), table, config)).toEqual({ kind: "no_proposal", reasons: ["too_few_readings"] });
    const fine = [reading(9, 1), reading(9, 2), reading(9, 3), reading(9, 4), reading(9, 5)];
    expect(proposeLowCarbMedicineReview(input({ glucose: fine }), table, config)).toEqual({ kind: "no_proposal", reasons: ["no_trigger"] });
  });

  it("readings outside the window or in the future do not count", () => {
    const r = proposeLowCarbMedicineReview(input({ glucose: [reading(5, 20), reading(5, -1)] }), table, config);
    expect(r).toEqual({ kind: "no_proposal", reasons: ["too_few_readings"] });
  });

  it("a draft table never drives a real patient", () => {
    const r = proposeLowCarbMedicineReview(input({ isTest: false }), table, config);
    expect(r).toEqual({ kind: "no_proposal", reasons: ["protocol_not_approved_for_real_patient"] });
    const approved = { ...table, status: "approved" as const };
    expect(proposeLowCarbMedicineReview(input({ isTest: false }), approved, config).kind).toBe("review");
    expect(proposeLowCarbMedicineReview(input({ isTest: true }), { ...table, status: "retired" }, config).kind).toBe("no_proposal");
  });

  it("every stop reason is reported together", () => {
    const r = proposeLowCarbMedicineReview(input({ programmeActive: false, pregnancy: "unknown", openTriage: "red" }), table, config);
    expect(r).toEqual({ kind: "no_proposal", reasons: ["programme_not_active", "pregnancy_or_unknown", "open_red_triage"] });
    expect(proposeLowCarbMedicineReview(input({ pregnancy: "yes", openTriage: "amber" }), table, config)).toEqual({
      kind: "no_proposal",
      reasons: ["pregnancy_or_unknown", "open_amber_triage"],
    });
  });

  it("a step with only an any-reading line, or only an average line, fires on its own condition", () => {
    const t: LowCarbStepTable = {
      ...table,
      steps: [
        { id: "a", match: { name_patterns: ["metformin"] }, when: { any_glucose_below_mmol: 3.0 }, action: "review_dose", rationale: "x" },
        { id: "b", match: { name_patterns: ["metformin"] }, when: {}, action: "review_dose", rationale: "y" },
      ],
    };
    const r = proposeLowCarbMedicineReview(input(), t, config);
    expect(r).toMatchObject({ kind: "review", proposals: [] });
  });

  it("builds the exact arguments for a signed-later stop proposal, and nothing else", () => {
    const r = proposeLowCarbMedicineReview(input({ glucose: [...falling, reading(3.6, 0.5)] }), table, config);
    if (r.kind !== "review") throw new Error("expected a review");
    const stop = r.proposals.find((p) => p.proposable);
    if (!stop) throw new Error("expected a proposable stop");
    expect(lowCarbProposalToChangeArgs(stop, "patient-1", "protocol-1", { a: 1 })).toEqual({
      p_patient: "patient-1",
      p_kind: "medication",
      p_proposal: { action: "stop", medication_id: "m1" },
      p_rationale: stop.rationale,
      p_proposed_by: "engine",
      p_protocol_id: "protocol-1",
      p_engine_inputs: { a: 1 },
    });
  });
});
