import { describe, expect, it } from "@jest/globals";
import { BP_CARE_V1, actionToString, grade, messageKeyFor, validateInput, validateRuleSet } from "./index";
import { buildContext, flattenParams } from "./context";
import { evaluate, type EvalEnv } from "./conditions";
import { isoWeekKey, lagosDateKey, lagosDaysBetween, isValidTimestamp, toMs } from "./dates";
import type { Condition, ObservationTrigger, RuleSet, TriageInput } from "./types";

const NOW = "2026-10-05T09:00:00Z";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const base = (over: Partial<TriageInput> = {}): TriageInput => ({
  trigger: { type: "observation", reading: { systolic: 120, diastolic: 78, takenAt: NOW }, symptoms: [] },
  history: [],
  target: { systolic: 135, diastolic: 85 },
  pathway: { state: "self_guided" },
  pregnant: false,
  ageYears: 45,
  now: NOW,
  ...over,
});
const obs = (over: Partial<ObservationTrigger>): TriageInput =>
  base({ trigger: { type: "observation", reading: { systolic: 120, diastolic: 78, takenAt: NOW }, symptoms: [], ...over } });
type Edit = readonly [path: string, value?: unknown];
/** A deep copy of the bundled rule set with edits applied by dotted path (`rules.0.id`); an edit with no value deletes the key. */
const edited = (...edits: Edit[]): RuleSet => {
  const rs = clone(BP_CARE_V1);
  for (const [path, ...value] of edits) {
    const keys = path.split(".");
    const last = keys.pop() as string;
    const holder = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, rs as unknown as Record<string, unknown>);
    if (value.length === 0) delete holder[last];
    else holder[last] = value[0];
  }
  return rs;
};

describe("validateRuleSet", () => {
  it("accepts the bundled rule set", () => expect(validateRuleSet(BP_CARE_V1)).toEqual([]));

  it.each<[string, Edit[], string]>([
    ["no code", [["code", ""]], "code is required"],
    ["bad version", [["version", 0]], "version must be"],
    ["bad validation block", [["params.validation", { systolicMin: 1 }]], "params.validation"],
    ["recheck window shorter than the wait", [["params.recheck", { afterMinutes: 10, windowMinutes: 5 }]], "params.recheck"],
    ["recheck missing", [["params.recheck"]], "params.recheck"],
    ["no averaging window", [["params.averageWindowDays", 0]], "averageWindowDays"],
    ["no red-flag group", [["params.symptomGroups", {}]], "symptomGroups"],
    ["symptom groups missing", [["params.symptomGroups"]], "symptomGroups"],
    ["rejected block missing", [["params.rejected"]], "params.rejected"],
    ["rejected block incomplete", [["params.rejected", { explanationKey: "TRI-006" }]], "params.rejected"],
    ["rule is not an object", [["rules.0", 5]], "must be an object"],
    ["rule without id", [["rules.0.id", ""]], "id is required"],
    ["duplicate rule id", [["rules.1.id", "BP-R1"]], "duplicate id"],
    ["no triggers", [["rules.0.triggers", []]], "triggers must"],
    ["bad trigger", [["rules.0.triggers", ["lab"]]], "triggers must"],
    ["triggers not a list", [["rules.0.triggers", "observation"]], "triggers must"],
    ["no explanation key", [["rules.0.explanationKey", ""]], "explanationKey"],
    ["bad result", [["rules.0.result", "maybe"]], "result must be"],
    ["bad grade", [["rules.0.grade", "purple"]], "grade must be"],
    ["actions not a list", [["rules.0.actions", "x"]], "actions must be a list"],
    ["unknown action", [["rules.0.actions", [{ kind: "fire" }]]], "bad action"],
    ["action not an object", [["rules.0.actions", [3]]], "bad action"],
    ["task without due", [["rules.3.actions.1.dueMinutes", 0]], "create_task needs"],
    ["task without notify key", [["rules.3.actions.1.notifyKey"]], "create_task needs"],
    ["red without a page", [["rules.0.actions", [{ kind: "show_emergency_guidance", code: "EMG-001" }]]], "INV-05"],
    ["red without guidance", [["rules.0.actions", [{ kind: "page_on_call" }]]], "INV-05"],
    ["task without an anchor", [["rules.3.taskAnchor"]], "taskAnchor"],
    ["reading anchor on a silence rule", [["rules.11.taskAnchor", "reading"]], "taskAnchor"],
    ["last-reading anchor on an observation rule", [["rules.3.taskAnchor", "lastReadingDate"]], "taskAnchor"],
    ["anchor on a rule with several triggers", [["rules.3.triggers", ["observation", "silence"]], ["rules.3.taskAnchor", "reading"]], "taskAnchor"],
    ["task anchor on a rule whose triggers are not a list", [["rules.3.triggers", "x"], ["rules.3.taskAnchor", "reading"]], "taskAnchor"],
    ["condition is not an object", [["rules.0.when", 5]], "condition must"],
    ["empty all list", [["rules.0.when", { all: [] }]], "non-empty"],
    ["all is not a list", [["rules.0.when", { any: "x" }]], "non-empty"],
    ["unknown symptom group", [["rules.0.when", { symptomGroup: "nope" }]], "unknown symptom group"],
    ["symptom group not a string", [["rules.0.when", { symptomGroup: 7 }]], "unknown symptom group"],
    ["unknown field", [["rules.0.when", { field: "reading.height", op: "gte", value: 1 }]], "unknown field"],
    ["bad operator", [["rules.0.when", { field: "pregnant", op: "like", value: 1 }]], "bad operator"],
    ["operator missing", [["rules.0.when", { field: "pregnant", value: 1 }]], "bad operator"],
    ["unknown ref", [["rules.0.when", { field: "pregnant", op: "eq", value: { ref: "params.nope" } }]], "unknown ref"],
    ["add not a number", [["rules.0.when", { field: "pregnant", op: "eq", value: { ref: "target.systolic", add: "1" } }]], "add must be"],
    ["value of a bad type", [["rules.0.when", { field: "pregnant", op: "eq", value: [1] }]], "bad value"],
    ["a symptom group named like a prototype member", [["rules.0.when", { symptomGroup: "constructor" }]], "unknown symptom group"],
    ["a symptom group that is not a list", [["params.symptomGroups.dizzy", "x"]], "unknown symptom group"],
    ["a not-condition that is bad", [["rules.0.when", { not: 4 }]], "condition must"],
  ])("refuses a rule set with %s", (_name, edits, message) => {
    const errors = validateRuleSet(edited(...edits));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("|")).toContain(message);
  });

  it("refuses non-objects and a rule set with no rules or no params", () => {
    expect(validateRuleSet(null)).toEqual(["rule set must be an object"]);
    expect(validateRuleSet([])).toEqual(["rule set must be an object"]);
    expect(validateRuleSet(edited(["params"]))).toContain("params is required");
    expect(validateRuleSet(edited(["rules", []]))).toContain("rules must be a non-empty list");
    expect(validateRuleSet(edited(["rules"]))).toContain("rules must be a non-empty list");
  });

  it("accepts a ref with an add and a literal string, number and boolean value", () => {
    const rs = edited([
      "rules.0.when",
      {
        all: [
          { field: "reading.systolic", op: "gte", value: { ref: "target.systolic", add: 10 } },
          { field: "trigger.type", op: "eq", value: "observation" },
          { field: "pregnant", op: "eq", value: false },
          { field: "age", op: "gt", value: 3 },
        ],
      },
    ]);
    expect(validateRuleSet(rs)).toEqual([]);
  });
});

describe("validateInput", () => {
  const v = (input: unknown) => validateInput(input as TriageInput, BP_CARE_V1);
  it("accepts good input of every trigger type", () => {
    expect(v(base())).toBeNull();
    expect(v(base({ trigger: { type: "adherence", percent7d: 70 } }))).toBeNull();
    expect(v(base({ trigger: { type: "adherence", percent7d: null } }))).toBeNull();
    expect(v(base({ trigger: { type: "silence", lastReadingAt: null, sinceAt: NOW } }))).toBeNull();
    expect(v(base({ trigger: { type: "silence", lastReadingAt: NOW, sinceAt: NOW } }))).toBeNull();
  });

  it("rejects implausible readings by each bound", () => {
    expect(v(obs({ reading: { systolic: 59, diastolic: 40, takenAt: NOW } }))).toBe("implausible_reading");
    expect(v(obs({ reading: { systolic: 299, diastolic: 40, takenAt: NOW } }))).toBeNull();
    expect(v(obs({ reading: { systolic: 300, diastolic: 40, takenAt: NOW } }))).toBe("implausible_reading");
    expect(v(obs({ reading: { systolic: 120, diastolic: 29, takenAt: NOW } }))).toBe("implausible_reading");
    expect(v(obs({ reading: { systolic: 250, diastolic: 201, takenAt: NOW } }))).toBe("implausible_reading");
    expect(v(obs({ reading: { systolic: 90, diastolic: 91, takenAt: NOW } }))).toBe("implausible_reading");
    expect(v(obs({ reading: { systolic: 90, diastolic: 90, takenAt: NOW } }))).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(v({ ...base(), now: "nope" })).toBe("invalid_input");
    expect(v({ ...base(), trigger: null })).toBe("invalid_input");
    expect(v({ ...base(), target: undefined })).toBe("invalid_input");
    expect(v({ ...base(), target: { systolic: "x", diastolic: 1 } })).toBe("invalid_input");
    expect(v({ ...base(), target: { systolic: 135, diastolic: NaN } })).toBe("invalid_input");
    expect(v({ ...base(), trigger: { type: "lab" } })).toBe("invalid_input");
    expect(v({ ...base(), target: { systolic: 0, diastolic: 80 } })).toBe("invalid_input");
    expect(v({ ...base(), history: undefined })).toBe("invalid_input");
    expect(v({ ...base(), pregnant: "no" })).toBe("invalid_input");
    expect(v({ ...base(), pathway: undefined })).toBe("invalid_input");
    expect(v({ ...base(), pathway: { state: 3 } })).toBe("invalid_input");
    expect(v({ ...base(), ageYears: "45" })).toBe("invalid_input");
    expect(v(obs({ reading: { systolic: "120", diastolic: 78, takenAt: NOW } as never }))).toBe("invalid_input");
    expect(v(obs({ reading: { systolic: 120, diastolic: 78, takenAt: "x" } }))).toBe("invalid_input");
    expect(v(obs({ symptoms: "chest_pain" as never }))).toBe("invalid_input");
    expect(v(obs({ recheck: 4 as never }))).toBe("invalid_input");
    expect(v(obs({ recheck: { kind: "later" } as never }))).toBe("invalid_input");
    const prev = { systolic: 182, diastolic: 112, takenAt: NOW };
    expect(v(obs({ recheck: { kind: "repeat", previous: prev, minutesSincePrevious: -1 } }))).toBe("invalid_input");
    expect(v(obs({ recheck: { kind: "repeat", previous: prev, minutesSincePrevious: "6" as never } }))).toBe("invalid_input");
    expect(v(obs({ recheck: { kind: "repeat", previous: { ...prev, systolic: 20 }, minutesSincePrevious: 6 } }))).toBe("invalid_input");
    expect(v(obs({ recheck: { kind: "repeat", previous: prev, minutesSincePrevious: 6 } }))).toBeNull();
    expect(v(obs({ recheck: { kind: "timed_out" } }))).toBeNull();
    expect(v(base({ trigger: { type: "adherence", percent7d: 101 } }))).toBe("invalid_input");
    expect(v(base({ trigger: { type: "adherence", percent7d: -1 } }))).toBe("invalid_input");
    expect(v(base({ trigger: { type: "adherence", percent7d: "7" as never } }))).toBe("invalid_input");
    expect(v(base({ trigger: { type: "silence", lastReadingAt: "x", sinceAt: NOW } }))).toBe("invalid_input");
    expect(v(base({ trigger: { type: "silence", lastReadingAt: null, sinceAt: "x" } }))).toBe("invalid_input");
  });
});

describe("grade: refusals and edges", () => {
  it("refuses an invalid rule set rather than grading with it, and says so", () => {
    const r = grade(base(), edited(["rules", []]));
    expect(r).toMatchObject({ status: "rejected", grade: null, reason: "invalid_rule_set", ruleSet: { code: "invalid", version: 0 } });
  });

  it("rejects malformed input, and still shows guidance for a red-flag symptom", () => {
    const r = grade(obs({ reading: { systolic: 120, diastolic: 78, takenAt: "x" }, symptoms: ["chest_pain"] }), BP_CARE_V1);
    expect(r).toMatchObject({ status: "rejected", reason: "invalid_input", redFlagSymptomPresent: true });
    expect(r.actions.map(actionToString)).toEqual(["show_emergency_guidance:EMG-001"]);
  });

  it("rejects a non-list of symptoms without guidance and a bad adherence trigger", () => {
    expect(grade(obs({ symptoms: "chest_pain" as never }), BP_CARE_V1)).toMatchObject({ status: "rejected", actions: [], redFlagSymptomPresent: false });
    expect(grade(base({ trigger: { type: "adherence", percent7d: 500 } }), BP_CARE_V1)).toMatchObject({ status: "rejected", actions: [] });
  });

  it("grades an observation green with no rule when the rule set has no green rules", () => {
    const rs: RuleSet = { ...BP_CARE_V1, rules: BP_CARE_V1.rules.filter((x) => x.grade !== "green") };
    expect(grade(base(), rs)).toMatchObject({ status: "graded", grade: "green", ruleId: null, explanationKey: null, actions: [] });
  });

  it("drops only a task key that is actually open", () => {
    const input = base({ trigger: { type: "adherence", percent7d: 10 }, pathway: { state: "care_pack_active" }, existingOpenTaskKeys: ["BP-A5:2026-09-29"] });
    const r = grade(input, BP_CARE_V1);
    expect(r.duplicateSuppressed).toBe(false);
    expect(r.actions.map(actionToString)).toEqual(["create_task:adherence_review"]);
  });

  it("does not change an input it was given", () => {
    const input = base({ history: [{ systolic: 150, diastolic: 90, takenAt: "2026-10-04T09:00:00Z" }] });
    const copy = clone(input);
    grade(input, BP_CARE_V1);
    expect(input).toEqual(copy);
  });

  it("a paused or discharged pathway never creates adherence or silence tasks", () => {
    for (const state of ["paused", "discharged", "referred_out"] as const) {
      const r = grade(base({ trigger: { type: "adherence", percent7d: 0 }, pathway: { state } }), BP_CARE_V1);
      expect(r.actions).toEqual([]);
    }
  });

  it("rule order decides a tie between ambers: the pregnancy route comes before the review task", () => {
    const r = grade(base({ pregnant: true, ageYears: 15 }), BP_CARE_V1);
    expect(r.ruleId).toBe("BP-P1");
    expect(r.matchedRuleIds).toEqual(expect.arrayContaining(["BP-P1", "BP-P2"]));
  });

  it("A1 and A1W never both match: a repeat is either confirmed or asked for again", () => {
    const prev = { systolic: 182, diastolic: 112, takenAt: "2026-10-05T08:54:00Z" };
    for (const minutes of [0, 1, 4.99, 5, 6, 15, 15.01, 30]) {
      const r = grade(obs({ reading: { systolic: 181, diastolic: 111, takenAt: NOW }, recheck: { kind: "repeat", previous: prev, minutesSincePrevious: minutes } }), BP_CARE_V1);
      expect(r.matchedRuleIds.filter((id) => id === "BP-A1" || id === "BP-A1W")).toHaveLength(1);
    }
  });
});

describe("rule thresholds sit exactly on the line", () => {
  const sys = (s: number, d: number, symptoms: ObservationTrigger["symptoms"] = []) =>
    grade(obs({ reading: { systolic: s, diastolic: d, takenAt: NOW }, symptoms }), BP_CARE_V1);
  it("BP-R1 at 180 and 120, not at 179 and 119", () => {
    expect(sys(180, 100, ["confusion"]).ruleId).toBe("BP-R1");
    expect(sys(150, 120, ["confusion"]).ruleId).toBe("BP-R1");
    expect(sys(179, 119, ["confusion"]).ruleId).toBe("BP-A6");
  });
  it("BP-R2 at 200 and 130, not at 199 and 129", () => {
    expect(sys(200, 100).ruleId).toBe("BP-R2");
    expect(sys(150, 130).ruleId).toBe("BP-R2");
    expect(sys(199, 129).ruleId).not.toBe("BP-R2");
  });
  it("BP-R3 below 90, not at 90", () => {
    expect(sys(89, 50, ["fainting"]).ruleId).toBe("BP-R3");
    expect(sys(90, 50, ["fainting"]).grade).toBe("green");
    expect(sys(89, 50, ["confusion"]).ruleId).toBe("BP-R3");
  });
  it("BP-A3 below 100 with dizziness, not at 100", () => {
    expect(sys(99, 60, ["dizziness"]).ruleId).toBe("BP-A3");
    expect(sys(100, 60, ["dizziness"]).grade).toBe("green");
  });
  it("the urgent line is 180 or 110", () => {
    expect(sys(180, 80).status).toBe("recheck_required");
    expect(sys(150, 110).status).toBe("recheck_required");
    expect(sys(179, 109).status).toBe("graded");
  });
  it("within target is strictly below both numbers", () => {
    expect(sys(134, 84).ruleId).toBe("BP-G1");
    expect(sys(135, 84).ruleId).toBe("BP-G2");
    expect(sys(134, 85).ruleId).toBe("BP-G2");
  });
  it("the adherence line is 80 and the silence line is 5 days", () => {
    const ad = (p: number) => grade(base({ trigger: { type: "adherence", percent7d: p }, pathway: { state: "care_pack_active" } }), BP_CARE_V1);
    expect(ad(79.9).grade).toBe("amber");
    expect(ad(80).grade).toBe("green");
    const si = (days: number) =>
      grade(base({ trigger: { type: "silence", lastReadingAt: `2026-09-${String(35 - days).padStart(2, "0")}T09:00:00Z`, sinceAt: "2026-08-01T00:00:00Z" }, pathway: { state: "care_pack_active" } }), BP_CARE_V1);
    expect(si(5).grade).toBe("amber");
    expect(si(4).grade).toBe("green");
  });
  it("the average needs 5 readings and 20 over systolic or 10 over diastolic", () => {
    const hist = (n: number, s: number, d: number) =>
      Array.from({ length: n }, (_, i) => ({ systolic: s, diastolic: d, takenAt: `2026-10-0${4 - i}T09:00:00Z` }));
    const t = { systolic: 130, diastolic: 80 };
    const run = (n: number, s: number, d: number) => grade(base({ trigger: { type: "observation", reading: { systolic: s, diastolic: d, takenAt: NOW }, symptoms: [] }, history: hist(n, s, d), target: t }), BP_CARE_V1).ruleId;
    expect(run(4, 150, 80)).toBe("BP-A2");
    expect(run(3, 150, 80)).toBe("BP-G2");
    expect(run(4, 149, 80)).toBe("BP-G2");
    expect(run(4, 130, 90)).toBe("BP-A2");
    expect(run(4, 130, 89)).toBe("BP-G2");
  });
});

describe("conditions", () => {
  const env = (ctx: EvalEnv["ctx"] = {}, symptoms: string[] = []): EvalEnv => ({
    ctx,
    params: { "params.a": 10 },
    groups: { redFlag: ["chest_pain"], g: ["fainting", "dizziness"] },
    symptoms: new Set(symptoms) as never,
  });
  it.each([
    ["gte", 5, 5, true], ["gte", 4, 5, false], ["gt", 6, 5, true], ["gt", 5, 5, false],
    ["lte", 5, 5, true], ["lte", 6, 5, false], ["lt", 4, 5, true], ["lt", 5, 5, false],
    ["eq", 5, 5, true], ["eq", 5, 6, false], ["neq", 5, 6, true], ["neq", 5, 5, false],
  ])("%s on %s and %s is %s", (op, left, right, expected) => {
    expect(evaluate({ field: "x", op, value: right } as Condition, env({ x: left }))).toBe(expected);
  });
  it("is false for an ordering test on a missing value or a non-number", () => {
    expect(evaluate({ field: "x", op: "gte", value: 1 }, env({ x: null }))).toBe(false);
    expect(evaluate({ field: "x", op: "lt", value: 1 }, env({ x: "a" }))).toBe(false);
    expect(evaluate({ field: "x", op: "lt", value: "b" }, env({ x: "a" }))).toBe(false);
  });
  it("resolves refs to context fields and params, with and without an addend", () => {
    expect(evaluate({ field: "x", op: "eq", value: { ref: "y" } }, env({ x: 3, y: 3 }))).toBe(true);
    expect(evaluate({ field: "x", op: "eq", value: { ref: "y", add: 2 } }, env({ x: 5, y: 3 }))).toBe(true);
    expect(evaluate({ field: "x", op: "eq", value: { ref: "params.a", add: 1 } }, env({ x: 11 }))).toBe(true);
    expect(evaluate({ field: "x", op: "gte", value: { ref: "y" } }, env({ x: 3, y: null }))).toBe(false);
    expect(evaluate({ field: "x", op: "gte", value: { ref: "y" } }, env({ x: 3, y: "s" }))).toBe(false);
  });
  it("combines all, any, not and symptom groups", () => {
    const t: Condition = { field: "x", op: "eq", value: 1 };
    const f: Condition = { field: "x", op: "eq", value: 2 };
    const e = env({ x: 1 }, ["dizziness"]);
    expect(evaluate({ all: [t, t] }, e)).toBe(true);
    expect(evaluate({ all: [t, f] }, e)).toBe(false);
    expect(evaluate({ any: [f, t] }, e)).toBe(true);
    expect(evaluate({ any: [f, f] }, e)).toBe(false);
    expect(evaluate({ not: f }, e)).toBe(true);
    expect(evaluate({ symptomGroup: "g" }, e)).toBe(true);
    expect(evaluate({ symptomGroup: "redFlag" }, e)).toBe(false);
  });
});

describe("context", () => {
  it("flattens only numbers, through nested objects, ignoring lists and strings", () => {
    expect(flattenParams({ a: 1, b: { c: 2, d: "x", e: [1] }, f: null })).toEqual({ "params.a": 1, "params.b.c": 2 });
  });
  it("counts only plausible readings inside the window, never from the future", () => {
    const ctx = buildContext(
      base({
        history: [
          { systolic: 150, diastolic: 90, takenAt: "2026-10-04T09:00:00Z" },
          { systolic: 150, diastolic: 90, takenAt: "bad" },
          { systolic: 150, diastolic: 90, takenAt: "2026-09-20T09:00:00Z" },
          { systolic: 150, diastolic: 90, takenAt: "2026-10-06T09:00:00Z" },
          { systolic: 20, diastolic: 90, takenAt: "2026-10-04T09:00:00Z" },
          { systolic: 400, diastolic: 90, takenAt: "2026-10-04T09:00:00Z" },
          { systolic: 150, diastolic: 20, takenAt: "2026-10-04T09:00:00Z" },
          { systolic: 150, diastolic: 250, takenAt: "2026-10-04T09:00:00Z" },
          { systolic: 100, diastolic: 120, takenAt: "2026-10-04T09:00:00Z" },
        ],
      }),
      BP_CARE_V1,
    );
    expect(ctx["avg.count"]).toBe(2);
    expect(ctx["avg.systolic"]).toBe(135);
  });
  it("has no average for an adherence trigger with no history, and always defines every field", () => {
    const ctx = buildContext(base({ trigger: { type: "adherence", percent7d: 50 } }), BP_CARE_V1);
    expect(ctx).toMatchObject({ "avg.count": 0, "avg.systolic": null, "avg.systolicOver": null, "adherence.percent7d": 50, "reading.systolic": null });
  });
  it("counts silence in Lagos calendar days from the last reading or, with none, the start", () => {
    const silence = (last: string | null, since: string) =>
      buildContext(base({ trigger: { type: "silence", lastReadingAt: last, sinceAt: since } }), BP_CARE_V1)["silence.days"];
    expect(silence("2026-10-04T23:30:00Z", "2026-01-01T00:00:00Z")).toBe(0);
    expect(silence("2026-10-04T22:30:00Z", "2026-01-01T00:00:00Z")).toBe(1);
    expect(silence(null, "2026-10-01T09:00:00Z")).toBe(4);
  });
});

describe("dates", () => {
  it("converts to the Lagos calendar day (UTC+1)", () => {
    expect(lagosDateKey(toMs("2026-10-05T22:59:59Z"))).toBe("2026-10-05");
    expect(lagosDateKey(toMs("2026-10-05T23:00:00Z"))).toBe("2026-10-06");
  });
  it("never counts negative days", () => expect(lagosDaysBetween(toMs("2026-10-06T00:00:00Z"), toMs("2026-10-05T00:00:00Z"))).toBe(0));
  it("labels ISO weeks across year boundaries", () => {
    expect(isoWeekKey("2026-10-05")).toBe("2026-W41");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2024-12-30")).toBe("2025-W01");
    expect(isoWeekKey("2026-10-11")).toBe("2026-W41");
    expect(isoWeekKey("2026-10-12")).toBe("2026-W42");
  });
  it("recognises real timestamps only", () => {
    expect(isValidTimestamp("2026-10-05T09:00:00Z")).toBe(true);
    expect(isValidTimestamp("nope")).toBe(false);
    expect(isValidTimestamp(5)).toBe(false);
  });
});

describe("actions and messages", () => {
  it("writes every action in the spec's compact form", () => {
    expect(actionToString({ kind: "show_emergency_guidance", code: "EMG-001" })).toBe("show_emergency_guidance:EMG-001");
    expect(actionToString({ kind: "show_message", code: "TRI-001" })).toBe("show_message:TRI-001");
    expect(actionToString({ kind: "prompt_recheck", code: "TRI-005" })).toBe("prompt_recheck:TRI-005");
    expect(actionToString({ kind: "route_referral", reason: "age" })).toBe("route_referral:age");
    expect(actionToString({ kind: "create_task", task: "bp_review", dueMinutes: 1, notifyKey: "k" })).toBe("create_task:bp_review");
    expect(actionToString({ kind: "page_on_call" })).toBe("page_on_call");
  });
  it("finds message keys for a code and returns null for none or an unknown code", () => {
    expect(messageKeyFor("TRI-001")).toEqual({ title: "triage.tri_001.title", body: "triage.tri_001.body" });
    expect(messageKeyFor(null)).toBeNull();
    expect(messageKeyFor("TRI-999")).toBeNull();
  });
});
