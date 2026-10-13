import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import {
  buildGlucoseContext,
  expectationWithDefaults,
  GLUCOSE_CARE_V1,
  GLUCOSE_CONTEXT_FIELDS,
  gradeGlucose,
  summarise,
  validateGlucoseInput,
  validateGlucoseRuleSet,
  type GlucoseInput,
  type GlucoseRuleSet,
  type ResultSummary,
} from "./index";

interface FixtureCase {
  id: string;
  title: string;
  safetyCase?: number;
  input: GlucoseInput;
  expect: Partial<ResultSummary>;
}
const fixtures: { ruleSet: { code: string; version: number }; cases: FixtureCase[] } = JSON.parse(
  readFileSync(new URL("../fixtures/glucose-safety-cases.json", import.meta.url), "utf8"),
);

const NOW = "2026-10-13T09:00:00Z";
function input(over: Partial<GlucoseInput> = {}, trig: Partial<GlucoseInput["trigger"]> = {}): GlucoseInput {
  return {
    trigger: { type: "glucose", reading: { mmol: 6, takenAt: NOW, context: "random" }, symptoms: [], ...trig },
    diabetesType: "type_2",
    pregnant: false,
    ageYears: 45,
    now: NOW,
    ...over,
  };
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const bad = (v: unknown) => v as GlucoseInput;

describe("glucose safety fixtures (CMO Q6 to Q9)", () => {
  it("names the rule set it was written for", () => {
    expect(fixtures.ruleSet).toEqual({ code: GLUCOSE_CARE_V1.code, version: GLUCOSE_CARE_V1.version });
  });

  it("has unique ids and covers the seven numbered glucose cases", () => {
    const ids = fixtures.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const covered = new Set(fixtures.cases.map((c) => c.safetyCase));
    for (const n of [1, 2, 3, 4, 5, 6, 7]) expect(covered.has(n)).toBe(true);
  });

  it.each(fixtures.cases.map((c) => [c.id, c.title, c] as const))("%s: %s", (_id, _title, c) => {
    expect(summarise(gradeGlucose(c.input, GLUCOSE_CARE_V1))).toEqual(expectationWithDefaults(c.expect));
  });

  it("gives identical results when the rule set and input arrive as JSON (the device path)", () => {
    const deviceRules = clone(GLUCOSE_CARE_V1);
    for (const c of fixtures.cases) expect(gradeGlucose(clone(c.input), deviceRules)).toEqual(gradeGlucose(c.input, GLUCOSE_CARE_V1));
  });

  it("is deterministic", () => {
    for (const c of fixtures.cases) expect(gradeGlucose(c.input, GLUCOSE_CARE_V1)).toEqual(gradeGlucose(c.input, GLUCOSE_CARE_V1));
  });

  it("every red shows guidance and pages on-call (INV-05), and nothing else pages", () => {
    for (const c of fixtures.cases) {
      const r = gradeGlucose(c.input, GLUCOSE_CARE_V1);
      const kinds = r.actions.map((a) => a.kind);
      if (r.grade === "red") expect(kinds).toEqual(expect.arrayContaining(["show_emergency_guidance", "page_on_call"]));
      else expect(kinds).not.toContain("page_on_call");
    }
  });

  it("a rejected result is never graded, and every result names its rule set (INV-16)", () => {
    for (const c of fixtures.cases) {
      const r = gradeGlucose(c.input, GLUCOSE_CARE_V1);
      if (r.status === "rejected") expect(r.grade).toBeNull();
      expect(r.ruleSet).toEqual({ code: "glucose_care_triage", version: 1 });
    }
  });

  it("the severe hypoglycaemia and suspected DKA reds never depend on who the patient is (Q9)", () => {
    const people: Partial<GlucoseInput>[] = [
      { pregnant: true },
      { ageYears: 8 },
      { ageYears: null },
      { diabetesType: null },
      { diabetesType: "gestational" },
      { diabetesType: "other" },
      { diabetesType: "type_1" },
    ];
    for (const who of people) {
      expect(gradeGlucose(input(who, { reading: { mmol: 2.4, takenAt: NOW, context: "night" } }), GLUCOSE_CARE_V1).grade).toBe("red");
      expect(gradeGlucose(input(who, { reading: { mmol: 14, takenAt: NOW, context: "random" }, ketones: { bloodMmol: 3.2 } }), GLUCOSE_CARE_V1).grade).toBe("red");
    }
  });

  it("every glucose from 0.5 to 55.5 gets a grade, and a higher glucose is never graded lower than a lower one above 3.9 with the same facts", () => {
    const rank = { green: 0, amber: 1, red: 2 } as const;
    let previous = 0;
    for (let tenths = 39; tenths <= 555; tenths++) {
      const r = gradeGlucose(input({}, { reading: { mmol: tenths / 10, takenAt: NOW, context: "random" } }), GLUCOSE_CARE_V1);
      expect(r.status).toBe("graded");
      const g = rank[r.grade as keyof typeof rank];
      expect(g).toBeGreaterThanOrEqual(previous);
      previous = g;
    }
    for (let tenths = 5; tenths < 39; tenths++) {
      const r = gradeGlucose(input({}, { reading: { mmol: tenths / 10, takenAt: NOW, context: "random" } }), GLUCOSE_CARE_V1);
      expect(r.grade === "red" || r.grade === "amber").toBe(true);
    }
  });
});

describe("glucose input validation", () => {
  const ok = () => input();
  it("accepts a normal reading", () => expect(validateGlucoseInput(ok(), GLUCOSE_CARE_V1)).toBeNull());
  it.each([
    ["no input at all", bad(undefined)],
    ["a trigger that is not an object", bad({ ...ok(), trigger: "x" })],
    ["a trigger of the wrong type", bad({ ...ok(), trigger: { ...ok().trigger, type: "observation" } })],
    ["a bad now", input({ now: "never" })],
    ["pregnant not a boolean", bad({ ...ok(), pregnant: "no" })],
    ["age not a number", bad({ ...ok(), ageYears: "old" })],
    ["an unknown diabetes type", bad({ ...ok(), diabetesType: "type_3" })],
    ["symptoms not a list", bad({ ...ok(), trigger: { ...ok().trigger, symptoms: "x" } })],
    ["a symptom that is not text", bad({ ...ok(), trigger: { ...ok().trigger, symptoms: [1] } })],
    ["a reading that is not an object", bad({ ...ok(), trigger: { ...ok().trigger, reading: 5 } })],
    ["a glucose that is not a number", bad({ ...ok(), trigger: { ...ok().trigger, reading: { mmol: "6", takenAt: NOW, context: "random" } } })],
    ["a bad reading time", bad({ ...ok(), trigger: { ...ok().trigger, reading: { mmol: 6, takenAt: "x", context: "random" } } })],
    ["an unknown context", bad({ ...ok(), trigger: { ...ok().trigger, reading: { mmol: 6, takenAt: NOW, context: "brunch" } } })],
    ["ketones that are not an object", bad({ ...ok(), trigger: { ...ok().trigger, ketones: 3 } })],
    ["blood ketones that are not a number", bad({ ...ok(), trigger: { ...ok().trigger, ketones: { bloodMmol: "3" } } })],
    ["an unknown urine band", bad({ ...ok(), trigger: { ...ok().trigger, ketones: { urine: "huge" } } })],
  ])("rejects %s as invalid_input", (_n, i) => expect(validateGlucoseInput(i, GLUCOSE_CARE_V1)).toBe("invalid_input"));

  it("accepts absent or null ketone fields", () => {
    expect(validateGlucoseInput(input({}, { ketones: {} }), GLUCOSE_CARE_V1)).toBeNull();
    expect(validateGlucoseInput(input({}, { ketones: { bloodMmol: null, urine: null } }), GLUCOSE_CARE_V1)).toBeNull();
  });

  it("rejects an implausible glucose or ketone value", () => {
    for (const mmol of [0.4, 55.6]) expect(validateGlucoseInput(input({}, { reading: { mmol, takenAt: NOW, context: "random" } }), GLUCOSE_CARE_V1)).toBe("implausible_reading");
    // Every value either entry form accepts (1.0 mmol/L, 18 mg/dL) is a plausible, graded reading.
    for (const mmol of [0.5, 1.0, 1.1]) expect(validateGlucoseInput(input({}, { reading: { mmol, takenAt: NOW, context: "random" } }), GLUCOSE_CARE_V1)).toBeNull();
  });

  it("a ketone value outside the meter range is never a reason to skip grading the glucose (it is clamped, not rejected)", () => {
    for (const bloodMmol of [-0.1, 20.1, 99]) expect(validateGlucoseInput(input({}, { ketones: { bloodMmol } }), GLUCOSE_CARE_V1)).toBeNull();
    const lowWithNonsense = gradeGlucose(input({}, { reading: { mmol: 2.4, takenAt: NOW, context: "night" }, ketones: { bloodMmol: 99 } }), GLUCOSE_CARE_V1);
    expect(lowWithNonsense).toMatchObject({ status: "graded", grade: "red", ruleId: "GL-R1" });
    expect(gradeGlucose(input({}, { reading: { mmol: 12, takenAt: NOW, context: "random" }, ketones: { bloodMmol: 99 } }), GLUCOSE_CARE_V1).ruleId).toBe("GL-R4");
    expect(gradeGlucose(input({}, { ketones: { bloodMmol: -3 } }), GLUCOSE_CARE_V1)).toMatchObject({ grade: "green" });
  });

  it("an age or diabetes type that is ABSENT (the server's jsonb_strip_nulls drops a null) means not recorded, never invalid input", () => {
    const stripped = JSON.parse(JSON.stringify({ ...input(), ageYears: null, diabetesType: null })) as Record<string, unknown>;
    delete stripped["ageYears"];
    delete stripped["diabetesType"];
    expect("ageYears" in stripped || "diabetesType" in stripped).toBe(false);
    expect(validateGlucoseInput(stripped as unknown as GlucoseInput, GLUCOSE_CARE_V1)).toBeNull();
    const low = { ...stripped, trigger: { ...(stripped["trigger"] as object), reading: { mmol: 2.0, takenAt: NOW, context: "night" } } } as unknown as GlucoseInput;
    expect(gradeGlucose(low, GLUCOSE_CARE_V1)).toMatchObject({ status: "graded", grade: "red", ruleId: "GL-R1" });
    expect(buildGlucoseContext(stripped as unknown as GlucoseInput)).toMatchObject({ age: null, "diabetes.type": "unknown" });
  });

  it("an invalid input is rejected by the engine with the rejected wording, never graded", () => {
    const r = gradeGlucose(bad({ ...input(), pregnant: "no" }), GLUCOSE_CARE_V1);
    expect(r).toMatchObject({ status: "rejected", grade: null, reason: "invalid_input", explanationKey: "GLU-T06", actions: [] });
  });

  it("a symptom list that is not a list shows no guidance and does not throw", () => {
    const r = gradeGlucose(bad({ ...input(), trigger: { ...input().trigger, symptoms: "seizure" } }), GLUCOSE_CARE_V1);
    expect(r.status).toBe("rejected");
    expect(r.redFlagSymptomPresent).toBe(false);
  });

  it("a missing input does not throw", () => {
    expect(gradeGlucose(bad(undefined), GLUCOSE_CARE_V1).status).toBe("rejected");
  });
});

describe("glucose context", () => {
  it("carries exactly the documented fields, all always present", () => {
    const ctx = buildGlucoseContext(input());
    expect(Object.keys(ctx).sort()).toEqual([...GLUCOSE_CONTEXT_FIELDS].sort());
  });
  it("reads ketones, urine bands and an unknown diabetes type", () => {
    const ctx = buildGlucoseContext(input({ diabetesType: null }, { ketones: { bloodMmol: 2.1, urine: "large" } }));
    expect(ctx["ketone.bloodMmol"]).toBe(2.1);
    expect(ctx["ketone.urineRaised"]).toBe(true);
    expect(ctx["diabetes.type"]).toBe("unknown");
    expect(buildGlucoseContext(input())["ketone.bloodMmol"]).toBeNull();
    expect(buildGlucoseContext(input({}, { ketones: { urine: "small" } }))["ketone.urineRaised"]).toBe(false);
  });
});

describe("glucose rule set validation", () => {
  const set = () => clone(GLUCOSE_CARE_V1) as unknown as Record<string, unknown> & { params: Record<string, unknown>; rules: Record<string, unknown>[] };
  it("accepts the shipped rule set", () => expect(validateGlucoseRuleSet(GLUCOSE_CARE_V1)).toEqual([]));

  it("refuses an invalid rule set without grading: invalid_rule_set, no guidance", () => {
    const s = set();
    s.rules = [];
    const r = gradeGlucose(input(), s as unknown as GlucoseRuleSet);
    expect(r).toMatchObject({ status: "rejected", reason: "invalid_rule_set", actions: [], grade: null });
  });

  const cases: [string, (s: ReturnType<typeof set>) => unknown][] = [
    ["a non-object", () => 5],
    ["no code", (s) => ({ ...s, code: "" })],
    ["a version of zero", (s) => ({ ...s, version: 0 })],
    ["no params", (s) => ({ ...s, params: undefined })],
    ["a bad validation block", (s) => ({ ...s, params: { ...s.params, validation: { glucoseMinMmol: 1 } } })],
    ["a bad adult age", (s) => ({ ...s, params: { ...s.params, minAdultAgeYears: "18" } })],
    ["a non-numeric hypo block", (s) => ({ ...s, params: { ...s.params, hypo: { severe: "3" } } })],
    ["a missing high block", (s) => ({ ...s, params: { ...s.params, high: undefined } })],
    ["no redFlag list", (s) => ({ ...s, params: { ...s.params, symptomGroups: {} } })],
    ["no rejected block", (s) => ({ ...s, params: { ...s.params, rejected: {} } })],
    ["no rules", (s) => ({ ...s, rules: [] })],
    ["a rule that is not an object", (s) => ({ ...s, rules: [5] })],
    ["a rule without an id", (s) => ({ ...s, rules: [{ ...s.rules[0], id: "" }] })],
    ["a duplicate id", (s) => ({ ...s, rules: [s.rules[0], s.rules[0]] })],
    ["a rule on the wrong trigger", (s) => ({ ...s, rules: [{ ...s.rules[0], triggers: ["observation"] }] })],
    ["a rule with no trigger", (s) => ({ ...s, rules: [{ ...s.rules[0], triggers: [] }] })],
    ["a rule without an explanation key", (s) => ({ ...s, rules: [{ ...s.rules[0], explanationKey: "" }] })],
    ["a recheck rule", (s) => ({ ...s, rules: [{ ...s.rules[0], result: "recheck" }] })],
    ["a bad grade", (s) => ({ ...s, rules: [{ ...s.rules[0], grade: "blue" }] })],
    ["actions that are not a list", (s) => ({ ...s, rules: [{ ...s.rules[0], actions: "x" }] })],
    ["a red rule without a page", (s) => ({ ...s, rules: [{ ...s.rules[0], actions: [{ kind: "show_emergency_guidance", code: "GLU-E01" }] }] })],
    ["a red rule whose actions are not objects", (s) => ({ ...s, rules: [{ ...s.rules[0], actions: [5] }] })],
    ["a task rule with no anchor", (s) => ({ ...s, rules: [{ ...s.rules.find((r) => r.id === "GL-A2")!, taskAnchor: "lastReadingDate" }] })],
    ["a condition with an unknown field", (s) => ({ ...s, rules: [{ ...s.rules[0], when: { field: "nope", op: "gt", value: 1 } }] })],
  ];
  it.each(cases)("refuses %s", (_n, mutate) => {
    expect(validateGlucoseRuleSet(mutate(set())).length).toBeGreaterThan(0);
  });

  it("grades green when a rule set has no rule that matches (nothing is silently dropped)", () => {
    const s = set();
    s.rules = [{ ...s.rules[0]!, when: { field: "glucose.mmol", op: "lt", value: 0 } }];
    s.rules[0] = { ...s.rules[0]!, grade: "red" };
    const r = gradeGlucose(input(), s as unknown as GlucoseRuleSet);
    expect(r).toMatchObject({ status: "graded", grade: "green", ruleId: null, explanationKey: null, actions: [] });
  });

  it("ties between rules of the same grade go to the earliest rule", () => {
    const s = set();
    const first = { ...s.rules.find((r) => r.id === "GL-A3")!, id: "A-FIRST", when: { field: "glucose.mmol", op: "gte", value: 0 }, actions: [{ kind: "show_message", code: "GLU-T02" }] };
    const second = { ...first, id: "A-SECOND" };
    s.rules = [second, first].map((x) => ({ ...x, taskAnchor: undefined }));
    expect(gradeGlucose(input(), s as unknown as GlucoseRuleSet).ruleId).toBe("A-SECOND");
  });
});

describe("glucose task keys", () => {
  it("an urgent review is anchored on the reading, a routing review on the ISO week", () => {
    expect(gradeGlucose(input({}, { reading: { mmol: 21, takenAt: NOW, context: "random" } }), GLUCOSE_CARE_V1).taskKey).toBe(`GL-A3:${NOW}`);
    expect(gradeGlucose(input({ pregnant: true }), GLUCOSE_CARE_V1).taskKey).toBe("GL-P1:2026-W42");
  });
});
