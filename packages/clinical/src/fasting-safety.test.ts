import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import {
  expectedFastWindow,
  fastingGate,
  fastingMessageKey,
  lagosDate,
  mayStartFast,
  parseFastingAnswer,
  publicFastingAnswer,
  yearsBefore,
  type FastingCalendarConfig,
  type FastingConditionRecord,
  type FastingGateInput,
  type FastingMedicine,
  type FastingSafetyConfig,
  type FastingTimingPlan,
  type FastingTriageEvent,
} from "./fasting-safety";

const config = getProposedConfig("fasting.safety_rules").value as unknown as FastingSafetyConfig;
const calendar = getProposedConfig("fasting.calendar").value as unknown as FastingCalendarConfig;
const NOW = "2026-10-20T12:00:00Z";
const ago = (hours: number): string => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

const ev = (grade: FastingTriageEvent["grade"], hoursAgo: number): FastingTriageEvent => ({ grade, at: ago(hoursAgo) });
const cond = (name: string, status = "active", icd10: string | null = null): FastingConditionRecord => ({ name, icd10, status });
const med = (name: string, prescriptionId: string | null = null, id = name): FastingMedicine => ({ id, name, prescriptionId });
const plan = (p: Partial<FastingTimingPlan> = {}): FastingTimingPlan => ({
  changeId: "chg-1",
  fast: "ramadan",
  validFrom: "2026-10-01",
  validTo: "2026-12-31",
  appliedPrescriptionId: "rx-1",
  ...p,
});
const input = (p: Partial<FastingGateInput> = {}): FastingGateInput => ({
  now: NOW,
  fast: "ramadan",
  dateOfBirth: "1980-01-01",
  events: [],
  conditions: [],
  medicines: [],
  timingPlans: [],
  pregnancyOrPostpartum: false,
  eatingDisorderScreenPositive: false,
  nutritionHold: false,
  ...p,
});

type Case = { id: string; input: FastingGateInput; decision: string; reason: string; blocks: string[]; covered?: string[] };
const may = (id: string, i: FastingGateInput, covered: string[] = []): Case => ({ id, input: i, decision: "may_fast_with_guidance", reason: "none", blocks: [], covered });
const planNeeded = (id: string, i: FastingGateInput, blocks: string[], covered: string[] = []): Case => ({ id, input: i, decision: "needs_clinician_plan", reason: blocks[0] as string, blocks, covered });
const stop = (id: string, i: FastingGateInput, blocks: string[]): Case => ({ id, input: i, decision: "not_advised", reason: blocks[0] as string, blocks });

/** Case ids are shared with packages/db/tests/s50b_fasting_safety.sql (fasting-safety-parity.test.ts pins them). */
const CASES: Case[] = [
  may("FS01", input()),
  stop("FS02", input({ events: [ev("red", 10)] }), ["recent_red_event"]),
  may("FS03", input({ events: [ev("red", 80)] })),
  planNeeded("FS04", input({ events: [ev("amber", 10)] }), ["recent_amber_event"]),
  stop("FS05", input({ pregnancyOrPostpartum: true }), ["pregnancy"]),
  stop("FS06", input({ dateOfBirth: "2012-05-05" }), ["under_age"]),
  may("FS07", input({ dateOfBirth: "2008-10-20" })),
  stop("FS08", input({ dateOfBirth: "2008-10-21" }), ["under_age"]),
  stop("FS09", input({ dateOfBirth: null }), ["under_age"]),
  stop("FS10", input({ conditions: [cond("Type 1 diabetes mellitus")], medicines: [med("Metformin", "rx-3")] }), ["type1_diabetes"]),
  stop("FS11", input({ conditions: [cond("Diabetes", "active", "E10.9")], medicines: [med("Metformin", "rx-3")] }), ["type1_diabetes"]),
  stop("FS12", input({ conditions: [cond("Chronic Kidney Disease")] }), ["kidney_disease"]),
  stop("FS13", input({ conditions: [cond("Unspecified", "active", "N18.3")] }), ["kidney_disease"]),
  stop("FS14", input({ eatingDisorderScreenPositive: true }), ["eating_disorder"]),
  stop("FS15", input({ conditions: [cond("Bulimia nervosa")] }), ["eating_disorder"]),
  planNeeded("FS16", input({ medicines: [med("Insulin glargine", "rx-1")] }), ["insulin"]),
  planNeeded("FS17", input({ medicines: [med("Gliclazide 80mg", "rx-2")] }), ["sulfonylurea"]),
  may("FS18", input({ medicines: [med("Insulin glargine", "rx-1")], timingPlans: [plan()] }), ["insulin"]),
  planNeeded("FS19", input({ medicines: [med("Insulin glargine", "rx-1")], timingPlans: [plan({ fast: "lent" })] }), ["insulin"]),
  planNeeded("FS20", input({ medicines: [med("Insulin glargine", "rx-1")], startsOn: "2026-11-01", endsOn: "2027-01-15", timingPlans: [plan()] }), ["insulin"]),
  planNeeded("FS21", input({ medicines: [med("Insulin glargine", "rx-1")], startsOn: "2026-09-20", endsOn: "2026-10-25", timingPlans: [plan()] }), ["insulin"]),
  planNeeded("FS22", input({ medicines: [med("Insulin glargine", "rx-1")], startsOn: "2026-01-01", endsOn: "2026-01-02", timingPlans: [plan({ validFrom: "2025-12-01", validTo: "2026-01-05" })] }), ["insulin"]),
  planNeeded("FS23", input({ medicines: [med("Insulin glargine", "rx-9")], timingPlans: [plan()] }), ["insulin"]),
  planNeeded("FS24", input({ medicines: [med("Insulin glargine", null)], timingPlans: [plan({ appliedPrescriptionId: null })] }), ["insulin"]),
  planNeeded("FS25", input({ medicines: [med("Insulin glargine", "rx-1"), med("Glimepiride", "rx-2")], timingPlans: [plan()] }), ["sulfonylurea"], ["insulin"]),
  planNeeded("FS26", input({ conditions: [cond("Type 2 diabetes")] }), ["diabetes_medicines_unconfirmed"]),
  may("FS27", input({ conditions: [cond("Type 2 diabetes")], medicines: [med("Metformin", "rx-3")] })),
  may("FS28", input({ conditions: [cond("Type 2 diabetes", "resolved")] })),
  stop("FS29", input({ pregnancyOrPostpartum: true, medicines: [med("Insulin glargine", "rx-1")] }), ["pregnancy", "insulin"]),
  stop("FS30", input({ events: [ev("red", 5), ev("amber", 5)] }), ["recent_red_event", "recent_amber_event"]),
  planNeeded("FS31", input({ medicines: [med("Insulin glargine", "rx-1", "a"), med("Insulin aspart", "rx-8", "b")], timingPlans: [plan()] }), ["insulin"]),
  planNeeded("FS38", input({ conditions: [cond("Type 2 diabetes")], medicines: [med("Amlodipine", "rx-4")] }), ["diabetes_medicines_unconfirmed"]),
  stop("FS39", input({ nutritionHold: true }), ["eating_disorder"]),
  planNeeded("FS40", input({ medicines: [med("Actrapid 100IU/ml", "rx-5")] }), ["insulin"]),
  may("FS35", input({ events: [ev("red", -2)] })),
  stop("FS36", input({ events: [ev("red", 72)] }), ["recent_red_event"]),
  may("FS37", input({ events: [ev("green", 1)] })),
];

describe("fastingGate (cases shared with the SQL proof)", () => {
  for (const c of CASES) {
    it(`${c.id}: ${c.decision} ${c.blocks.join("+") || "none"}`, () => {
      const r = fastingGate(c.input, config);
      expect(r.decision).toBe(c.decision);
      expect(r.reason).toBe(c.reason);
      expect(r.blocks).toEqual(c.blocks);
      expect(r.covered).toEqual(c.covered ?? []);
    });
  }

  it("FS18 names the plan that cleared the insulin block", () => {
    expect(fastingGate(input({ medicines: [med("Insulin glargine", "rx-1")], timingPlans: [plan()] }), config).timingChangeIds).toEqual(["chg-1"]);
  });

  it("an explicit start and end inside the plan window are covered", () => {
    const r = fastingGate(input({ medicines: [med("Insulin glargine", "rx-1")], startsOn: "2026-11-01", endsOn: "2026-11-30", timingPlans: [plan()] }), config);
    expect(r.decision).toBe("may_fast_with_guidance");
  });

  it("an empty pattern in the config never matches everything", () => {
    const odd = { ...config, medicine_classes: { ...config.medicine_classes, insulin: { name_patterns: ["", "insulin"] } } };
    expect(fastingGate(input({ medicines: [med("Metformin", "rx-1")] }), odd).decision).toBe("may_fast_with_guidance");
    const oddCond = { ...config, matches: { ...config.matches, kidney_disease: { name_patterns: [""], icd10_prefixes: ["N18"] } } };
    expect(fastingGate(input({ conditions: [cond("Anything")] }), oddCond).decision).toBe("may_fast_with_guidance");
  });

  it("a softer configured outcome still stops being a hard stop (needs a clinician instead)", () => {
    const soft = { ...config, outcomes: { ...config.outcomes, pregnancy: "needs_clinician_plan" as const } };
    expect(fastingGate(input({ pregnancyOrPostpartum: true }), soft).decision).toBe("needs_clinician_plan");
  });

  it("FS32: a withheld pregnancy answer is unavailable, never a guess", () => {
    const r = fastingGate(input({ pregnancyOrPostpartum: null }), config);
    expect(r.blocks).toEqual(["rules_unavailable"]);
    expect(r.decision).toBe("not_advised");
  });

  it("FS33: no config refuses", () => {
    expect(fastingGate(input(), null).reason).toBe("rules_unavailable");
  });

  it("FS34: an unreadable clock refuses", () => {
    expect(fastingGate(input({ now: "not a time" }), config).reason).toBe("rules_unavailable");
  });
});

describe("publicFastingAnswer", () => {
  const pub = (i: FastingGateInput) => publicFastingAnswer(fastingGate(i, config));

  it("every sensitive reason collapses to the same single unavailable answer", () => {
    const sensitive = [
      input({ pregnancyOrPostpartum: true }),
      input({ dateOfBirth: "2012-05-05" }),
      input({ conditions: [cond("Type 1 diabetes")] }),
      input({ conditions: [cond("Chronic kidney disease")] }),
      input({ eatingDisorderScreenPositive: true }),
      input({ pregnancyOrPostpartum: null }),
    ];
    for (const i of sensitive) expect(pub(i)).toEqual({ state: "unavailable" });
  });

  it("a sensitive reason hides a red event too (the answer cannot reveal which applied)", () => {
    expect(pub(input({ pregnancyOrPostpartum: true, events: [ev("red", 2)] }))).toEqual({ state: "unavailable" });
  });

  it("an insulin user is told a clinician-signed medicine timing plan is needed, not why in any other way", () => {
    expect(pub(input({ medicines: [med("Insulin glargine", "rx-1")] }))).toEqual({
      state: "ok", decision: "needs_clinician_plan", reason: "medicine_timing_plan_needed", blocks: ["medicine_timing_plan_needed"], hasTimingPlan: false,
    });
  });

  it("two medicine blocks collapse to one public block", () => {
    const a = pub(input({ medicines: [med("Insulin glargine", "rx-1"), med("Gliclazide", "rx-2")] }));
    expect(a.state === "ok" && a.blocks).toEqual(["medicine_timing_plan_needed"]);
  });

  it("a red event is shown as paused", () => {
    expect(pub(input({ events: [ev("red", 1)] }))).toMatchObject({ state: "ok", decision: "not_advised", reason: "recent_red_event" });
  });

  it("a covered insulin user may fast and the answer says a plan exists", () => {
    expect(pub(input({ medicines: [med("Insulin glargine", "rx-1")], timingPlans: [plan()] }))).toEqual({
      state: "ok", decision: "may_fast_with_guidance", reason: "none", blocks: [], hasTimingPlan: true,
    });
  });

  it("the priority order carries through (red first, then the medicine block)", () => {
    const a = pub(input({ events: [ev("red", 1)], medicines: [med("Insulin glargine", "rx-1")] }));
    expect(a.state === "ok" && a.blocks).toEqual(["recent_red_event", "medicine_timing_plan_needed"]);
  });
});

describe("parseFastingAnswer", () => {
  const good = { state: "ok", decision: "needs_clinician_plan", reason: "medicine_timing_plan_needed", blocks: ["medicine_timing_plan_needed"], has_timing_plan: false };

  it("reads a good reply", () => {
    expect(parseFastingAnswer(good)).toEqual({ state: "ok", decision: "needs_clinician_plan", reason: "medicine_timing_plan_needed", blocks: ["medicine_timing_plan_needed"], hasTimingPlan: false });
    expect(parseFastingAnswer({ state: "ok", decision: "may_fast_with_guidance", reason: "none", blocks: [], has_timing_plan: true })).toMatchObject({ hasTimingPlan: true });
  });

  it("fails closed to unavailable for anything else", () => {
    const bad: unknown[] = [
      null, "x", 5, { state: "unavailable" }, { ...good, state: "maybe" }, { ...good, decision: "yes" }, { ...good, decision: 4 },
      { ...good, blocks: "none" }, { ...good, blocks: ["pregnancy"] }, { ...good, blocks: [] },
      { ...good, decision: "may_fast_with_guidance" }, { ...good, reason: "recent_red_event" },
    ];
    for (const b of bad) expect(parseFastingAnswer(b)).toEqual({ state: "unavailable" });
  });
});

describe("messages and starting", () => {
  it("each answer maps to one key that exists in English", () => {
    const keys = [
      fastingMessageKey({ state: "unavailable" }),
      fastingMessageKey({ state: "ok", decision: "may_fast_with_guidance", reason: "none", blocks: [], hasTimingPlan: false }),
      fastingMessageKey({ state: "ok", decision: "needs_clinician_plan", reason: "recent_amber_event", blocks: ["recent_amber_event"], hasTimingPlan: false }),
      fastingMessageKey({ state: "ok", decision: "not_advised", reason: "recent_red_event", blocks: ["recent_red_event"], hasTimingPlan: false }),
    ];
    expect(new Set(keys).size).toBe(4);
    for (const k of keys) expect(en[k]).toBeTruthy();
  });

  it("only the one permissive answer may start a fast", () => {
    expect(mayStartFast({ state: "unavailable" })).toBe(false);
    expect(mayStartFast({ state: "ok", decision: "needs_clinician_plan", reason: "recent_amber_event", blocks: ["recent_amber_event"], hasTimingPlan: false })).toBe(false);
    expect(mayStartFast({ state: "ok", decision: "may_fast_with_guidance", reason: "none", blocks: [], hasTimingPlan: false })).toBe(true);
  });
});

describe("dates", () => {
  it("lagosDate moves a late UTC evening into the next Lagos day", () => {
    expect(lagosDate("2026-10-20T23:30:00Z")).toBe("2026-10-21");
    expect(lagosDate("bad")).toBeNull();
  });

  it("yearsBefore clamps 29 February like Postgres", () => {
    expect(yearsBefore("2028-02-29", 18)).toBe("2010-02-28");
    expect(yearsBefore("2028-02-29", 4)).toBe("2024-02-29");
    expect(yearsBefore("2100-02-29", 4)).toBe("2096-02-29");
    expect(yearsBefore("2024-02-29", 24)).toBe("2000-02-29");
    expect(yearsBefore("2026-10-20", 18)).toBe("2008-10-20");
  });

  it("the expected window is the next one on or after today, or unknown", () => {
    expect(expectedFastWindow(calendar, "ramadan", "2026-10-20")?.year).toBe(2027);
    expect(expectedFastWindow(calendar, "ramadan", "2027-02-20")?.year).toBe(2027);
    expect(expectedFastWindow(calendar, "ramadan", "2027-03-20")?.year).toBe(2028);
    expect(expectedFastWindow(calendar, "lent", "2030-01-01")).toBeNull();
    expect(expectedFastWindow(null, "lent", "2026-10-20")).toBeNull();
    const unordered: FastingCalendarConfig = { ramadan: [{ year: 2, start: "2029-01-01", end: "2029-02-01" }, { year: 1, start: "2028-01-01", end: "2028-02-01" }], lent: [] };
    expect(expectedFastWindow(unordered, "ramadan", "2026-01-01")?.year).toBe(1);
  });
});
