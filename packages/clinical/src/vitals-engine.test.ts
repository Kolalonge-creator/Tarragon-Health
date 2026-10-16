import { describe, expect, it } from "@jest/globals";
import {
  buildVitalsContext,
  gradeVitals,
  validateVitalsInput,
  validateVitalsRuleSet,
  VITALS_CARE_V1,
  VITALS_CONTEXT_FIELDS,
  VITALS_METRICS,
  VITALS_RULE_SET_CODE,
  type VitalsInput,
  type VitalsMetric,
  type VitalsRuleSet,
} from "./index";

const NOW = "2026-10-16T09:00:00Z";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function input(type: VitalsMetric, value: number, over: Partial<VitalsInput> = {}): VitalsInput {
  return { trigger: { type, reading: { value, takenAt: NOW } }, ageYears: 45, now: NOW, ...over };
}
const g = (type: VitalsMetric, value: number, over: Partial<VitalsInput> = {}) => gradeVitals(input(type, value, over), VITALS_CARE_V1);

/**
 * The oracle: the older SQL classifiers (private.classify_pulse_level, classify_spo2_level, classify_temperature_level), written out again here from
 * their migrations. The engine must agree with them on every value inside the possible range, because parity with the older alerts is what lets the
 * CMO retire them. A level of emergency or red is a red grade; amber is amber.
 */
type Level = "emergency" | "red" | "amber" | "green";
const pulseOracle = (b: number): Level => (b <= 35 || b >= 150 ? "emergency" : b <= 39 || b >= 121 ? "red" : b <= 49 || b >= 101 ? "amber" : "green");
const spo2Oracle = (p: number): Level => (p < 90 ? "emergency" : p <= 92 ? "red" : p <= 94 ? "amber" : "green");
const tempOracle = (t: number): Level => (t >= 40 || t < 35 ? "emergency" : t >= 39 ? "red" : t >= 38 ? "amber" : "green");
const gradeOf = (l: Level) => (l === "emergency" || l === "red" ? "red" : l);

describe("vitals_care_triage v1: agreement with the older per-vital classifiers", () => {
  it("pulse: every whole bpm from 10 to 300, for an adult", () => {
    for (let bpm = 10; bpm <= 300; bpm++) {
      const r = g("pulse", bpm);
      expect([bpm, r.grade]).toEqual([bpm, gradeOf(pulseOracle(bpm))]);
    }
  });
  it("spo2: every whole percent from 50 to 100", () => {
    for (let p = 50; p <= 100; p++) {
      const r = g("spo2", p);
      expect([p, r.grade]).toEqual([p, gradeOf(spo2Oracle(p))]);
    }
  });
  it("temperature: every tenth of a degree from 25.0 to 45.0", () => {
    for (let tenth = 250; tenth <= 450; tenth++) {
      const t = tenth / 10;
      const r = g("temperature", t);
      expect([t, r.grade]).toEqual([t, gradeOf(tempOracle(t))]);
    }
  });
  it("tells an emergency band from a red band by the guidance code, so the two are never confused", () => {
    expect(g("pulse", 35).explanationKey).toBe("VIT-E01");
    expect(g("pulse", 36).explanationKey).toBe("VIT-E02");
    expect(g("pulse", 150).explanationKey).toBe("VIT-E01");
    expect(g("pulse", 149).explanationKey).toBe("VIT-E02");
    expect(g("spo2", 89).explanationKey).toBe("VIT-E01");
    expect(g("spo2", 90).explanationKey).toBe("VIT-E02");
    expect(g("temperature", 34.9).explanationKey).toBe("VIT-E01");
    expect(g("temperature", 39.9).explanationKey).toBe("VIT-E02");
    expect(g("temperature", 40).explanationKey).toBe("VIT-E01");
  });
});

describe("vitals_care_triage v1: what each grade does", () => {
  it("every red shows emergency guidance and pages on call (INV-05)", () => {
    for (const [m, v] of [["pulse", 30], ["pulse", 130], ["spo2", 85], ["spo2", 91], ["temperature", 41], ["temperature", 39.4]] as const) {
      const r = g(m, v);
      expect(r.grade).toBe("red");
      expect(r.actions.map((a) => a.kind)).toEqual(["show_emergency_guidance", "page_on_call"]);
    }
  });
  it("an amber shows a message and opens one review task, a green only a message", () => {
    for (const [m, v] of [["pulse", 45], ["pulse", 110], ["spo2", 94], ["temperature", 38.2]] as const) {
      const r = g(m, v);
      expect(r.grade).toBe("amber");
      expect(r.actions.map((a) => a.kind)).toEqual(["show_message", "create_task"]);
      expect(r.taskKey).toMatch(/^VT-(PU4|OX3|TE3):2026-W\d\d$/);
    }
    for (const [m, v] of [["pulse", 72], ["spo2", 98], ["temperature", 36.8]] as const) {
      const r = g(m, v);
      expect([r.grade, r.actions.map((a) => a.kind), r.taskKey]).toEqual(["green", ["show_message"], null]);
    }
  });
  it("a second amber in the same week is suppressed, not duplicated", () => {
    const first = g("spo2", 94);
    const again = g("spo2", 93, { existingOpenTaskKeys: [first.taskKey as string] });
    expect(again.duplicateSuppressed).toBe(true);
    expect(again.actions.map((a) => a.kind)).toEqual(["show_message"]);
    expect(g("spo2", 93, { existingOpenTaskKeys: ["something-else"] }).duplicateSuppressed).toBe(false);
  });
  it("a reading with a task anchored on the reading itself keys on the reading time", () => {
    const rs = clone(VITALS_CARE_V1) as unknown as { rules: Array<{ id: string; taskAnchor?: string }> };
    const rule = rs.rules.find((r) => r.id === "VT-OX3");
    if (!rule) throw new Error("fixture rule missing");
    rule.taskAnchor = "reading";
    expect(gradeVitals(input("spo2", 94), rs as unknown as VitalsRuleSet).taskKey).toBe(`VT-OX3:${NOW}`);
  });
  it("only the reading's own metric is graded: a pulse of 30 does not trip a temperature rule and the reverse", () => {
    expect(g("pulse", 30).matchedRuleIds).toEqual(["VT-PU1", "VT-PU2", "VT-PU4"]);
    expect(g("temperature", 36.8).matchedRuleIds).toEqual(["VT-TE5"]);
    expect(g("spo2", 97).matchedRuleIds).toEqual(["VT-OX5"]);
  });
});

describe("vitals_care_triage v1: a patient under 18", () => {
  it("is routed to a clinician for a heart rate outside the adult resting range, not paged on the adult red band", () => {
    for (const bpm of [39, 45, 101, 130, 149]) {
      const r = g("pulse", bpm, { ageYears: 12 });
      expect([bpm, r.grade, r.ruleId]).toEqual([bpm, "amber", "VT-PU3"]);
      expect(r.actions.map((a) => a.kind)).toEqual(["show_message", "route_referral", "create_task"]);
    }
  });
  it("still gets the emergency page for a severe heart rate, and the same SpO2 and temperature bands", () => {
    expect(g("pulse", 30, { ageYears: 12 }).grade).toBe("red");
    expect(g("pulse", 160, { ageYears: 12 }).grade).toBe("red");
    expect(g("spo2", 88, { ageYears: 12 }).grade).toBe("red");
    expect(g("temperature", 39.5, { ageYears: 12 }).grade).toBe("red");
  });
  it("is graded as an adult when the age is unknown or exactly 18 (nothing is invented)", () => {
    expect(g("pulse", 130, { ageYears: null }).ruleId).toBe("VT-PU2");
    expect(g("pulse", 130, { ageYears: 18 }).ruleId).toBe("VT-PU2");
    const stripped = { trigger: { type: "pulse", reading: { value: 130, takenAt: NOW } }, now: NOW } as unknown as VitalsInput;
    expect(gradeVitals(stripped, VITALS_CARE_V1).ruleId).toBe("VT-PU2");
  });
  it("a normal child's heart rate is saved", () => {
    expect(g("pulse", 80, { ageYears: 12 }).grade).toBe("green");
  });
});

describe("vitals_care_triage v1: the patient's own amber line", () => {
  it("turns a green SpO2 amber at or below the line, and nothing else", () => {
    expect(g("spo2", 96, { personalAmberLine: 96 }).ruleId).toBe("VT-OX4");
    expect(g("spo2", 97, { personalAmberLine: 96 }).grade).toBe("green");
    expect(g("spo2", 93, { personalAmberLine: 96 }).ruleId).toBe("VT-OX3");
    expect(g("spo2", 91, { personalAmberLine: 96 }).grade).toBe("red");
    expect(g("spo2", 96, { personalAmberLine: null }).grade).toBe("green");
  });
  it("turns a green temperature amber at or above the line, and nothing else", () => {
    expect(g("temperature", 37.5, { personalAmberLine: 37.5 }).ruleId).toBe("VT-TE4");
    expect(g("temperature", 37.4, { personalAmberLine: 37.5 }).grade).toBe("green");
    expect(g("temperature", 38.5, { personalAmberLine: 37.5 }).ruleId).toBe("VT-TE3");
    expect(g("temperature", 39.5, { personalAmberLine: 37.5 }).grade).toBe("red");
  });
  it("is ignored for a pulse reading", () => {
    expect(g("pulse", 72, { personalAmberLine: 96 }).grade).toBe("green");
  });
});

describe("vitals_care_triage v1: input validation", () => {
  it("rejects a value outside the possible range and never grades it", () => {
    for (const [m, v] of [["pulse", 9], ["pulse", 301], ["spo2", 49], ["spo2", 101], ["temperature", 24.9], ["temperature", 45.1], ["temperature", 3.6]] as const) {
      const r = g(m, v);
      expect([m, v, r.status, r.reason, r.grade, r.actions, r.explanationKey]).toEqual([m, v, "rejected", "implausible_reading", null, [], "VIT-T04"]);
    }
  });
  it("keeps the edges of the possible range gradable, so a true extreme is never a typo", () => {
    expect(g("pulse", 10).grade).toBe("red");
    expect(g("pulse", 300).grade).toBe("red");
    expect(g("spo2", 50).grade).toBe("red");
    expect(g("temperature", 25).grade).toBe("red");
    expect(g("temperature", 45).grade).toBe("red");
  });
  it("rejects malformed input as invalid_input", () => {
    const bad: unknown[] = [
      null,
      { ...input("pulse", 70), trigger: null },
      { ...input("pulse", 70), trigger: { type: "glucose", reading: { value: 5, takenAt: NOW } } },
      { ...input("pulse", 70), now: "not a time" },
      { ...input("pulse", 70), ageYears: "old" },
      { ...input("spo2", 97), personalAmberLine: "high" },
      { ...input("pulse", 70), trigger: { type: "pulse", reading: null } },
      { ...input("pulse", 70), trigger: { type: "pulse", reading: { value: "70", takenAt: NOW } } },
      { ...input("pulse", 70), trigger: { type: "pulse", reading: { value: 70, takenAt: "nope" } } },
      { ...input("pulse", 70), trigger: { type: "pulse", reading: { value: Number.NaN, takenAt: NOW } } },
    ];
    for (const b of bad) expect(validateVitalsInput(b as VitalsInput, VITALS_CARE_V1)).toBe("invalid_input");
    expect(validateVitalsInput(input("pulse", 70), VITALS_CARE_V1)).toBeNull();
    expect(gradeVitals({ ...input("pulse", 70), now: "x" }, VITALS_CARE_V1).reason).toBe("invalid_input");
  });
});

describe("vitals_care_triage v1: context", () => {
  it("has exactly the documented field list, always present, null when not applicable", () => {
    const ctx = buildVitalsContext(input("spo2", 93, { personalAmberLine: 95 }));
    expect(Object.keys(ctx).sort()).toEqual([...VITALS_CONTEXT_FIELDS].sort());
    expect(ctx).toEqual({
      "trigger.type": "spo2",
      "pulse.bpm": null,
      "spo2.pct": 93,
      "temperature.c": null,
      "spo2.personalAmberAtOrBelow": 95,
      "temperature.personalAmberAtOrAbove": null,
      age: 45,
    });
    expect(buildVitalsContext(input("temperature", 38, { personalAmberLine: 37.6 }))["temperature.personalAmberAtOrAbove"]).toBe(37.6);
    expect(buildVitalsContext(input("pulse", 70, { ageYears: null })).age).toBeNull();
    expect(buildVitalsContext(input("pulse", 70, { personalAmberLine: Number.NaN }))["spo2.personalAmberAtOrBelow"]).toBeNull();
  });
  it("knows its three metrics and its code", () => {
    expect(VITALS_METRICS).toEqual(["pulse", "spo2", "temperature"]);
    expect(VITALS_RULE_SET_CODE).toBe("vitals_care_triage");
  });
});

describe("vitals_care_triage v1: the rule set itself", () => {
  it("is valid, a draft, version 1, and every rule names exactly one metric", () => {
    expect(validateVitalsRuleSet(VITALS_CARE_V1)).toEqual([]);
    expect(VITALS_CARE_V1.status).toBe("draft");
    expect(VITALS_CARE_V1.version).toBe(1);
    expect(VITALS_CARE_V1.rules.every((r) => r.triggers.length === 1)).toBe(true);
    expect(VITALS_CARE_V1.rules.map((r) => r.triggers[0])).toEqual(["pulse", "pulse", "pulse", "pulse", "pulse", "spo2", "spo2", "spo2", "spo2", "spo2", "temperature", "temperature", "temperature", "temperature", "temperature"]);
  });
  it("an invalid rule set grades nothing (the older pipeline keeps covering the patient)", () => {
    const bad = clone(VITALS_CARE_V1) as unknown as Record<string, unknown>;
    bad.rules = [];
    const r = gradeVitals(input("pulse", 30), bad as unknown as VitalsRuleSet);
    expect([r.status, r.reason, r.grade, r.actions, r.ruleSet]).toEqual(["rejected", "invalid_rule_set", null, [], { code: "invalid", version: 0 }]);
  });
  it("a metric with no matching rule is graded green with no rule (an empty winner) rather than throwing", () => {
    const rs = clone(VITALS_CARE_V1) as unknown as { rules: Array<{ triggers: string[] }> };
    rs.rules = rs.rules.filter((r) => r.triggers[0] !== "spo2");
    const r = gradeVitals(input("spo2", 97), rs as unknown as VitalsRuleSet);
    expect([r.status, r.grade, r.ruleId, r.explanationKey, r.actions]).toEqual(["graded", "green", null, null, []]);
  });

  describe("structural validation", () => {
    const mutate = (fn: (rs: any) => void): string[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const rs = clone(VITALS_CARE_V1) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      fn(rs);
      return validateVitalsRuleSet(rs);
    };
    const has = (errors: string[], text: string) => errors.some((e) => e.includes(text));

    it("rejects non-objects and missing parts", () => {
      expect(validateVitalsRuleSet(null)).toEqual(["rule set must be an object"]);
      expect(validateVitalsRuleSet([])).toEqual(["rule set must be an object"]);
      expect(has(mutate((rs) => { rs.code = ""; }), "code is required")).toBe(true);
      expect(has(mutate((rs) => { rs.version = 0; }), "version must be")).toBe(true);
      expect(has(mutate((rs) => { rs.version = 1.5; }), "version must be")).toBe(true);
      expect(has(mutate((rs) => { rs.params = null; }), "params is required")).toBe(true);
      expect(has(mutate((rs) => { rs.params.validation = null; }), "params.validation needs")).toBe(true);
      expect(has(mutate((rs) => { rs.params.validation.pulseMax = "x"; }), "params.validation needs")).toBe(true);
      expect(has(mutate((rs) => { rs.params.minAdultAgeYears = "18"; }), "minAdultAgeYears")).toBe(true);
      expect(has(mutate((rs) => { rs.params.pulse = null; }), "params.pulse must be")).toBe(true);
      expect(has(mutate((rs) => { rs.params.spo2.redAtOrBelow = "92"; }), "params.spo2 must be")).toBe(true);
      expect(has(mutate((rs) => { rs.params.rejected = {}; }), "params.rejected needs")).toBe(true);
      expect(has(mutate((rs) => { rs.params.rejected = null; }), "params.rejected needs")).toBe(true);
      expect(has(mutate((rs) => { rs.rules = "none"; }), "rules must be a non-empty list")).toBe(true);
    });
    it("rejects a bad rule", () => {
      expect(has(mutate((rs) => { rs.rules[0] = "x"; }), "rules[0]: must be an object")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].id = ""; }), "id is required")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[1].id = rs.rules[0].id; }), "duplicate id")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].triggers = []; }), "triggers must name exactly one")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].triggers = ["pulse", "spo2"]; }), "triggers must name exactly one")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].triggers = ["glucose"]; }), "triggers must name exactly one")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].triggers = "pulse"; }), "triggers must name exactly one")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].explanationKey = ""; }), "explanationKey is required")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].result = "recheck"; }), "result must be grade")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].grade = "blue"; }), "grade must be")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].actions = "none"; }), "actions must be a list")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].actions = [{ kind: "fly" }]; }), "bad action")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].actions = [{ kind: "page_on_call" }, "x"]; }), "bad action")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].when = { field: "nope", op: "lt", value: 1 }; }), "unknown field")).toBe(true);
    });
    it("holds INV-05: a red without both the guidance and the page is refused", () => {
      expect(has(mutate((rs) => { rs.rules[0].actions = [{ kind: "page_on_call" }]; }), "INV-05")).toBe(true);
      expect(has(mutate((rs) => { rs.rules[0].actions = [{ kind: "show_emergency_guidance", code: "VIT-E01" }]; }), "INV-05")).toBe(true);
    });
    it("a task rule must say what its key is anchored on", () => {
      expect(has(mutate((rs) => { delete rs.rules[3].taskAnchor; }), "taskAnchor")).toBe(true);
    });
  });
});
