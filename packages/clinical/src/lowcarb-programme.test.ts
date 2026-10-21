import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "@tarragon/shared";
import {
  classifyLowCarbMedicine,
  classifyLowCarbReading,
  coarsenLowCarbReasons,
  lowCarbCheckins,
  lowCarbConditionMatches,
  lowCarbEditDistance,
  lowCarbEligibility,
  lowCarbNameMatches,
  lowCarbNormalise,
  lowCarbTextHas,
  lowCarbUnreadable,
  lowCarbStopDraftArgs,
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
const meds = (...names: string[]) => names.map((name) => ({ name, indication: null }));
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
  { id: "L11", input: { medicines: meds("Jardiance 10mg") }, expected: "not_eligible|medicine_sglt2_inhibitor" },
  { id: "L12", input: { medicines: meds("Insulin glargine") }, expected: "needs_supervision|supervision_insulin" },
  { id: "L13", input: { medicines: meds("Insulin glargine"), confirmations: { noRecentAdmission: true, supervisionAccepted: true } }, expected: "eligible|none" },
  { id: "L14", input: { medicines: meds("Gliclazide 80mg") }, expected: "needs_supervision|supervision_sulfonylurea" },
  { id: "L15", input: { glucoseReadings: [{ mmol: 2.5, at: daysAgo(10) }] }, expected: "not_eligible|recent_severe_low_sugar" },
  { id: "L16", input: { glucoseReadings: [{ mmol: 2.5, at: daysAgo(100) }] }, expected: "eligible|none" },
  { id: "L17", input: { glucoseReadings: [{ mmol: 3.5, at: daysAgo(10) }] }, expected: "eligible|none" },
  { id: "L18", input: { confirmations: { noRecentAdmission: false, supervisionAccepted: false } }, expected: "not_eligible|admission_not_ruled_out" },
  { id: "L19", input: { triageEvents: [{ grade: "red", at: hoursAgo(24) }] }, expected: "not_now|recent_triage_event" },
  { id: "L20", input: { triageEvents: [{ grade: "amber", at: hoursAgo(100) }] }, expected: "eligible|none" },
  { id: "L21", input: { diabetesType: { confirmed: "type_1", reported: null }, pregnancy: "yes" }, expected: "not_eligible|not_type_2,pregnancy_or_postnatal" },
  { id: "L22", input: { pregnancy: "yes", medicines: meds("Insulin glargine") }, expected: "not_eligible|pregnancy_or_postnatal" },
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
    expect(lowCarbNameMatches("anything", [""])).toBe(false);
  });

  it("every exclusion in the config is a real list, and every medicine group has a known handling", () => {
    for (const m of Object.values(config.eligibility.condition_exclusions)) expect(Array.isArray(m.name_patterns)).toBe(true);
    for (const g of Object.values(config.eligibility.medicine_groups)) expect(["supervision", "exclude", "allow"]).toContain(g.handling);
  });

  it("insulin and a sulfonylurea both need supervision, and an SGLT2 inhibitor is excluded (CMO to confirm)", () => {
    expect(config.eligibility.medicine_groups.insulin?.handling).toBe("supervision");
    expect(config.eligibility.medicine_groups.sulfonylurea?.handling).toBe("supervision");
    expect(config.eligibility.medicine_groups.sglt2_inhibitor?.handling).toBe("exclude");
  });
});

/** Medicine cases M01..M20 are shared with packages/db/tests/s50b_lowcarb_t2d_programme.sql (lowcarb-parity.test.ts pins them). */
const MED_CASES: { id: string; meds: { name: string; indication: string | null }[]; expected: string }[] = [
  { id: "M01", meds: meds("Mixtard 30/70 100IU/ml"), expected: "needs_supervision|supervision_insulin" },
  { id: "M02", meds: meds("GLIBENCLAMIDE 5mg"), expected: "needs_supervision|supervision_sulfonylurea" },
  { id: "M03", meds: meds("metformin + glibenclamide"), expected: "needs_supervision|supervision_sulfonylurea" },
  { id: "M04", meds: meds("Synjardy 5/1000"), expected: "not_eligible|medicine_sglt2_inhibitor" },
  { id: "M05", meds: meds("Metformin 500mg"), expected: "eligible|none" },
  { id: "M06", meds: meds("Januvia 100mg"), expected: "eligible|none" },
  { id: "M07", meds: meds("gliclazid MR 60"), expected: "needs_supervision|supervision_sulfonylurea" },
  { id: "M08", meds: meds("Zorglibex 10mg"), expected: "needs_supervision|supervision_unclassified" },
  { id: "M09", meds: [{ name: "SomeNewTablet", indication: "for diabetes" }], expected: "needs_supervision|supervision_unclassified" },
  { id: "M10", meds: [{ name: "Amlodipine 5mg", indication: "blood pressure" }], expected: "eligible|none" },
  { id: "M11", meds: meds(""), expected: "needs_supervision|supervision_unclassified" },
  { id: "M12", meds: meds("Tresiba FlexTouch"), expected: "needs_supervision|supervision_insulin" },
  { id: "M13", meds: meds("Daonyl 5"), expected: "needs_supervision|supervision_sulfonylurea" },
  { id: "M14", meds: meds("Glyvenol 400mg"), expected: "eligible|none" },
  { id: "M15", meds: meds("Glucophage XR 1000"), expected: "eligible|none" },
  { id: "M16", meds: meds("Repaglinide 1mg"), expected: "needs_supervision|supervision_meglitinide" },
  { id: "M17", meds: meds("Ozempic 0.5"), expected: "eligible|none" },
  { id: "M18", meds: meds("Humalog Mix 25"), expected: "needs_supervision|supervision_insulin" },
  { id: "M19", meds: meds("Lantus", "Jardiance 10mg"), expected: "not_eligible|medicine_sglt2_inhibitor" },
  { id: "M20", meds: meds("Paracetamol 500mg", "Vitamin D"), expected: "eligible|none" },
  { id: "M21", meds: meds("Novo Rapid FlexPen"), expected: "needs_supervision|supervision_insulin" },
  { id: "M22", meds: meds("Mixtrad 30/70"), expected: "needs_supervision|supervision_insulin" },
  { id: "M23", meds: meds("Fiasb"), expected: "needs_supervision|supervision_insulin" },
  { id: "M24", meds: meds("Insul\u00edn glargine"), expected: "needs_supervision|supervision_insulin" },
  { id: "M25", meds: meds("\uff29\uff2e\uff33\uff35\uff2c\uff29\uff2e"), expected: "needs_supervision|supervision_unclassified" },
  { id: "M26", meds: meds("Steglujan"), expected: "not_eligible|medicine_sglt2_inhibitor" },
  { id: "M27", meds: meds("Daonli 5mg"), expected: "needs_supervision|supervision_sulfonylurea" },
  { id: "M28", meds: meds("Xultophy 100/3.6"), expected: "needs_supervision|supervision_insulin" },
  { id: "M29", meds: meds("in\u00adsulin"), expected: "needs_supervision|supervision_insulin" },
  { id: "M30", meds: meds("Metform\u00edn 500mg"), expected: "eligible|none" },
];

describe("medicine classification (the fail-safe)", () => {
  it.each(MED_CASES)("$id", ({ meds: m, expected }) => {
    expect(elig({ medicines: m })).toBe(expected);
  });

  it("an unrecognised diabetes medicine is never read as 'no medicine of concern'", () => {
    for (const name of ["Zorglibex", "Diabetamax", "Sugarstop 10mg"]) {
      expect(elig({ medicines: meds(name) }).startsWith("needs_supervision")).toBe(true);
    }
  });

  it("an accepted supervision lets an unrecognised diabetes medicine through, and only then", () => {
    const r = lowCarbEligibility({ ...base, medicines: meds("Zorglibex"), confirmations: { noRecentAdmission: true, supervisionAccepted: true } }, config);
    expect(r.decision).toBe("eligible");
    expect(r.supervisionFor).toEqual(["unclassified"]);
  });

  it("two medicines of the same risk group are reported once", () => {
    expect(elig({ medicines: meds("Lantus", "Mixtard") })).toBe("needs_supervision|supervision_insulin");
    expect(elig({ medicines: meds("Jardiance", "Forxiga") })).toBe("not_eligible|medicine_sglt2_inhibitor");
  });

  it("classifies each class and a combination", () => {
    expect(classifyLowCarbMedicine({ name: "Metformin/glibenclamide", indication: null }, config)).toEqual({ risk: ["sulfonylurea"], allowed: ["metformin"], unclassified: false });
    expect(classifyLowCarbMedicine({ name: "Xigduo XR", indication: null }, config).risk).toEqual(["sglt2_inhibitor"]);
    expect(classifyLowCarbMedicine({ name: "Insulin glargine", indication: null }, config).risk).toEqual(["insulin"]);
  });

  it("a misspelling within one slip (two for long names) still matches; a different word does not", () => {
    expect(lowCarbNameMatches("glimepirid", ["glimepiride"])).toBe(true);
    expect(lowCarbNameMatches("empagliflozn 10", ["empagliflozin"])).toBe(true);
    expect(lowCarbNameMatches("glimeperide", ["glimepiride"])).toBe(true);
    expect(lowCarbNameMatches("gliclazide", ["glimepiride"])).toBe(false);
    expect(lowCarbNameMatches("lisinopril", ["insulin"])).toBe(false);
  });

  it("short patterns match only as a plain substring, and a multi-word pattern only as written", () => {
    expect(lowCarbNameMatches("Amaryl", ["amaryl"])).toBe(true);
    expect(lowCarbNameMatches("Amarl", ["amaryl"])).toBe(true);
    expect(lowCarbNameMatches("xyz", ["xyzq"])).toBe(false);
    expect(lowCarbNameMatches("novo mix 30", ["novo mix"])).toBe(true);
    expect(lowCarbNameMatches("novo mx 30", ["novo mix"])).toBe(false);
  });

  it("a swap of two neighbouring letters is one slip; short brand names are matched fuzzily too", () => {
    expect(lowCarbEditDistance("mixtard", "mixtrad")).toBe(1);
    expect(lowCarbNameMatches("Lantsu", ["lantus"])).toBe(true);
    expect(lowCarbNameMatches("Qtern", ["qtern"])).toBe(true);
    expect(lowCarbNameMatches("Qtren", ["qtern"])).toBe(true);
    expect(lowCarbNameMatches("Novo Rapid", ["novorapid"])).toBe(true);
  });

  it("accents and invisible characters are folded, and a name with a letter we cannot read fails safe", () => {
    expect(lowCarbNormalise("Insul\u00edn")).toBe("insulin");
    expect(lowCarbNormalise("in\u00adsulin")).toBe("insulin");
    expect(lowCarbUnreadable("Insul\u00edn")).toBe(false);
    expect(lowCarbUnreadable("\uff29\uff2e\uff33")).toBe(true);
    expect(classifyLowCarbMedicine({ name: "\u0438\u043d\u0441\u0443\u043b\u0438\u043d", indication: null }, config).unclassified).toBe(true);
    expect(classifyLowCarbMedicine({ name: "\uff2d\uff45\uff54\uff46\uff4f\uff52\uff4d\uff49\uff4e Metformin", indication: null }, config).unclassified).toBe(true);
  });

  it("normalising and distance helpers", () => {
    expect(lowCarbNormalise("  GLIBENCLAMIDE-5mg / Tabs ")).toBe("glibenclamide 5mg tabs");
    expect(lowCarbEditDistance("kitten", "sitting")).toBe(3);
    expect(lowCarbEditDistance("", "ab")).toBe(2);
    expect(lowCarbTextHas(null, ["diabet"])).toBe(false);
    expect(lowCarbTextHas("For Type 2 Diabetes", ["diabet"])).toBe(true);
    expect(lowCarbTextHas("blood pressure", ["diabet", ""])).toBe(false);
  });

  it("the shipped config always carries the markers and at least one risk group", () => {
    expect(config.eligibility.diabetes_markers.name_patterns.length).toBeGreaterThan(0);
    expect(Object.values(config.eligibility.medicine_groups).some((g) => g.handling !== "allow")).toBe(true);
  });
});

describe("what a clinician without reproductive-health access is shown", () => {
  it("every not-eligible answer collapses to one vague reason, with or without a pregnancy among the causes", () => {
    const withPregnancy = coarsenLowCarbReasons({ decision: "not_eligible", reasons: ["pregnancy_or_postnatal", "under_age"] }, false);
    const without = coarsenLowCarbReasons({ decision: "not_eligible", reasons: ["under_age", "condition_kidney_disease"] }, false);
    expect(withPregnancy).toEqual(["health_condition"]);
    expect(without).toEqual(withPregnancy);
  });
  it("shows the real reasons to a clinician the category-scoped path entitles", () => {
    expect(coarsenLowCarbReasons({ decision: "not_eligible", reasons: ["pregnancy_or_postnatal", "under_age"] }, true)).toEqual(["pregnancy_or_postnatal", "under_age"]);
  });
  it("other decisions are shown as they are (a pregnant person is always not eligible)", () => {
    expect(coarsenLowCarbReasons({ decision: "needs_supervision", reasons: ["supervision_insulin"] }, false)).toEqual(["supervision_insulin"]);
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

  it("the standing review alone raises a review; sugars fine, so the two sugar-lowering medicines are listed for a hand review", () => {
    const r = proposeLowCarbMedicineReview(input({ glucose: [reading(9, 1), reading(9, 2), reading(9, 3), reading(9, 4), reading(9, 5)], lastMedicineReviewAt: daysAgo(20) }), table, config);
    expect(r).toMatchObject({ kind: "review", triggers: ["standing_review_due"] });
    expect(r.kind === "review" && r.proposals.map((p) => `${p.stepId}:${p.drugName}`)).toEqual(["no_step_for_group:Gliclazide", "no_step_for_group:Lantus insulin"]);
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
        { id: "a", match: { groups: ["metformin"] }, when: { any_glucose_below_mmol: 3.0 }, action: "review_dose", rationale: "x" },
        { id: "b", match: { groups: ["dpp4_inhibitor"] }, when: { any_glucose_below_mmol: 9 }, action: "review_dose", rationale: "y" },
      ],
    };
    const r = proposeLowCarbMedicineReview(input(), t, config);
    expect(r.kind === "review" && r.proposals.map((p) => p.stepId)).toEqual(["no_step_for_group", "no_step_for_group"]);
  });

  it("a diabetes medicine the config does not recognise is listed for the doctor, never skipped", () => {
    const r = proposeLowCarbMedicineReview(input({ medicines: [med("m7", "Zorglibex 10mg")] }), table, config);
    expect(r.kind === "review" && r.proposals.map((p) => `${p.stepId}:${p.proposable}`)).toEqual(["unclassified_diabetes_medicine:false"]);
  });

  it("an unrecognised medicine is listed even beside a recognised one that has its own suggestion", () => {
    const r = proposeLowCarbMedicineReview(input({ medicines: [med("m1", "Gliclazide"), med("m7", "Zorglibex 10mg")] }), table, config);
    expect(r.kind === "review" && r.proposals.map((p) => p.stepId)).toEqual(["su_review_on_fall", "unclassified_diabetes_medicine"]);
  });

  it("a medicine that can lower sugar and has no step of its own is listed for the doctor, never skipped", () => {
    const r = proposeLowCarbMedicineReview(input({ medicines: [med("m8", "Repaglinide 1mg")] }), table, config);
    expect(r.kind === "review" && r.proposals.map((p) => `${p.stepId}:${p.proposable}`)).toEqual(["no_step_for_group:false"]);
  });

  it("a medicine the config does not list but whose recorded reason says diabetes is listed too", () => {
    const r = proposeLowCarbMedicineReview(input({ medicines: [{ ...med("m9", "SomeNewTablet"), indication: "for diabetes" }] }), table, config);
    expect(r.kind === "review" && r.proposals.map((p) => p.stepId)).toEqual(["unclassified_diabetes_medicine"]);
  });

  it("a step table naming a group the config does not have is refused whole, and says so", () => {
    const bad: LowCarbStepTable = { ...table, steps: [{ id: "x", match: { groups: ["sulfonylureas"] }, when: { any_glucose_below_mmol: 9 }, action: "stop", rationale: "typo" }] };
    expect(proposeLowCarbMedicineReview(input(), bad, config)).toEqual({ kind: "no_proposal", reasons: ["step_table_invalid"] });
    const empty: LowCarbStepTable = { ...table, steps: [{ id: "y", match: { groups: [] }, when: { any_glucose_below_mmol: 9 }, action: "stop", rationale: "none" }] };
    expect(proposeLowCarbMedicineReview(input(), empty, config).kind).toBe("no_proposal");
  });

  it("builds the exact arguments for a signed-later stop proposal, and nothing else", () => {
    const r = proposeLowCarbMedicineReview(input({ glucose: [...falling, reading(3.6, 0.5)] }), table, config);
    if (r.kind !== "review") throw new Error("expected a review");
    const stop = r.proposals.find((p) => p.proposable);
    if (!stop) throw new Error("expected a proposable stop");
    expect(lowCarbStopDraftArgs(stop, "patient-1", "protocol-1", { a: 1 })).toEqual({
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
