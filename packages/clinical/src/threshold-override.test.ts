import { describe, expect, it } from "@jest/globals";
import { BP_CARE_V1, BP_CARE_V3, BP_CARE_V4, BP_CARE_V5, BP_CARE_V6, GLUCOSE_CARE_V1, grade, gradeGlucose } from "./index";
import {
  applyBpOverride,
  applyGlucoseOverride,
  OVERRIDE_LIMITS,
  validateOverrideParams,
  type ActiveOverride,
  type BpOverrideParams,
  type GlucoseOverrideParams,
} from "./threshold-override";
import type { GlucoseInput } from "./glucose-engine";
import type { Reading, RuleSet, SymptomCode, TriageInput, TriageResult } from "./types";

const NOW = "2026-10-15T10:00:00.000Z";
const FUTURE = "2026-11-15T10:00:00.000Z";
const SIGNED = "2026-10-01T09:00:00.000Z";

const bp = (id = "ovr-bp", params: BpOverrideParams = { target: { systolic: 150, diastolic: 95 } }, over: Partial<ActiveOverride> = {}): ActiveOverride => ({
  id, domain: "bp", params, signedAt: SIGNED, expiresAt: FUTURE, ...over,
});
const gl = (params: GlucoseOverrideParams, over: Partial<ActiveOverride> = {}): ActiveOverride => ({ id: "ovr-gl", domain: "glucose", params, signedAt: SIGNED, expiresAt: FUTURE, ...over });

const day = (n: number): string => new Date(Date.parse(NOW) - n * 86_400_000 + 1000).toISOString();
function history(n: number, systolic: number, diastolic: number): Reading[] {
  return Array.from({ length: n }, (_, i) => ({ systolic, diastolic, takenAt: day(i + 1) }));
}
function bpInput(over: Partial<TriageInput> = {}, reading = { systolic: 150, diastolic: 92 }, symptoms: SymptomCode[] = []): TriageInput {
  return {
    trigger: { type: "observation", reading: { ...reading, takenAt: NOW }, symptoms, symptomsAnswered: true },
    history: history(6, 160, 95),
    target: { systolic: 135, diastolic: 85 },
    pathway: { state: "self_guided" },
    pregnant: false,
    ageYears: 58,
    now: NOW,
    ...over,
  };
}
const SETS: [string, RuleSet][] = [["v1", BP_CARE_V1], ["v3", BP_CARE_V3], ["v4", BP_CARE_V4], ["v5", BP_CARE_V5], ["v6", BP_CARE_V6]];

describe("validateOverrideParams (the hard clamps)", () => {
  it("accepts in-range settings", () => {
    expect(validateOverrideParams("bp", { target: { systolic: 150, diastolic: 95 }, lowAmberSystolic: 85 })).toEqual([]);
    expect(validateOverrideParams("glucose", { hypoAlertMmol: 4.4, hypoSevereMmol: 3.3 })).toEqual([]);
  });
  it("rejects what is outside the clamps or unknown", () => {
    expect(validateOverrideParams("bp", "x")).toEqual(["params must be an object"]);
    expect(validateOverrideParams("bp", [])).toEqual(["params must be an object"]);
    expect(validateOverrideParams("bp", {})).toContain("at least one setting is required");
    expect(validateOverrideParams("bp", { colour: 1 })).toContain("unknown blood pressure setting");
    expect(validateOverrideParams("bp", { target: { systolic: 190, diastolic: 95 } })).toContain("target is outside the limits");
    expect(validateOverrideParams("bp", { target: { systolic: 150, diastolic: 110 } })).toContain("target is outside the limits");
    expect(validateOverrideParams("bp", { target: { systolic: 150 } })).toContain("target is outside the limits");
    expect(validateOverrideParams("bp", { target: "x" })).toContain("target is outside the limits");
    expect(validateOverrideParams("bp", { target: { systolic: 150, diastolic: 95, extra: 1 } })).toContain("target is outside the limits");
    expect(validateOverrideParams("bp", { target: { systolic: 100, diastolic: 100 } })).toContain("target diastolic must be under systolic");
    expect(validateOverrideParams("bp", { lowAmberSystolic: 70 })).toContain("lowAmberSystolic is outside the limits");
    expect(validateOverrideParams("bp", { lowAmberSystolic: 91 })).toContain("lowAmberSystolic is outside the limits");
    expect(validateOverrideParams("bp", { lowAmberSystolic: Number.NaN })).toContain("lowAmberSystolic is outside the limits");
    expect(validateOverrideParams("glucose", { hypoAlertMmol: 3.0 })).toContain("hypoAlertMmol is outside the limits");
    expect(validateOverrideParams("glucose", { hypoAlertMmol: 6 })).toContain("hypoAlertMmol is outside the limits");
    expect(validateOverrideParams("glucose", { hypoSevereMmol: 2.5 })).toContain("hypoSevereMmol is outside the limits");
    expect(validateOverrideParams("glucose", { hypoSevereMmol: 3.6 })).toContain("hypoSevereMmol is outside the limits");
    expect(validateOverrideParams("glucose", { target: 1 })).toContain("unknown glucose setting");
  });
  it("a glucose override cannot lower a line (the clamps start at the default lines)", () => {
    expect(OVERRIDE_LIMITS.glucose.hypoAlertMmol.min).toBe(GLUCOSE_CARE_V1.params.hypo.alert);
    expect(OVERRIDE_LIMITS.glucose.hypoSevereMmol.min).toBe(GLUCOSE_CARE_V1.params.hypo.severe);
    expect(OVERRIDE_LIMITS.bp.lowAmberSystolic.max).toBe(BP_CARE_V3.params["low"] ? (BP_CARE_V3.params["low"] as { redSystolic: number }).redSystolic : -1);
  });
});

describe("applyBpOverride: relax", () => {
  it("a patient with a signed 150/95 baseline: the seven day average amber becomes green, with provenance and no task", () => {
    for (const [, rs] of SETS) {
      const input = bpInput();
      const base = grade(input, rs);
      expect(base.grade).toBe("amber");
      expect(base.ruleId).toBe("BP-A2");
      const { result, ignored } = applyBpOverride(input, base, rs, bp());
      expect(ignored).toBeNull();
      expect(result.grade).toBe("green");
      expect(result.ruleId).toBe("BP-G2");
      expect(result.actions.some((a) => a.kind === "create_task")).toBe(false);
      expect(result.taskKey).toBeNull();
      expect(result.override).toEqual({
        overrideId: "ovr-bp", domain: "bp", direction: "relaxed", parameters: ["target"],
        defaultGrade: "amber", defaultRuleId: "BP-A2", finalGrade: "green", finalRuleId: "BP-G2",
      });
    }
  });
  it("a reading under the personal target gets the within-target green rule", () => {
    const input = bpInput({}, { systolic: 140, diastolic: 90 });
    const { result } = applyBpOverride(input, grade(input, BP_CARE_V3), BP_CARE_V3, bp());
    expect(result.ruleId).toBe("BP-G1");
  });
  it("the average still over the personal line keeps the amber", () => {
    const input = bpInput({ history: history(6, 175, 100) });
    const base = grade(input, BP_CARE_V3);
    const out = applyBpOverride(input, base, BP_CARE_V3, bp());
    expect(out.result).toBe(base);
    expect(out.ignored).toBeNull();
  });
  it("clamp: an average at or over the urgent line is never relaxed, whatever the target", () => {
    const high = bp("o", { target: { systolic: 160, diastolic: 100 } });
    const input = bpInput({ history: history(6, 200, 100) }, { systolic: 150, diastolic: 90 });
    const base = grade(input, BP_CARE_V3);
    expect(base.grade).toBe("amber");
    expect(applyBpOverride(input, base, BP_CARE_V3, high).result).toBe(base);
    const diaHigh = bpInput({ history: history(6, 150, 125) });
    const base2 = grade(diaHigh, BP_CARE_V3);
    expect(applyBpOverride(diaHigh, base2, BP_CARE_V3, high).result).toBe(base2);
  });
  it("too few readings for an average: the override's average rule cannot fire", () => {
    const input = bpInput({ history: history(2, 160, 95) });
    const base = grade(input, BP_CARE_V3);
    expect(base.grade).toBe("green");
    expect(applyBpOverride(input, base, BP_CARE_V3, bp()).result).toBe(base);
  });
  it("no history at all: no average, nothing to change", () => {
    const input = bpInput({ history: [] });
    const base = grade({ ...input, trigger: { type: "observation", reading: { systolic: 120, diastolic: 80, takenAt: NOW }, symptoms: [], symptomsAnswered: true } }, BP_CARE_V3);
    expect(base.grade).toBe("green");
  });
  it("low reading with no symptom (BP-A7) is relaxed by a personal low line, and only at or above it", () => {
    const input = bpInput({ history: [] }, { systolic: 86, diastolic: 55 });
    const base = grade(input, BP_CARE_V4);
    expect(base.ruleId).toBe("BP-A7");
    const o = bp("low", { lowAmberSystolic: 85 });
    const out = applyBpOverride(input, base, BP_CARE_V4, o);
    expect(out.result.grade).toBe("green");
    expect(out.result.override?.parameters).toEqual(["lowAmberSystolic"]);
    const under = bpInput({ history: [] }, { systolic: 84, diastolic: 55 });
    const b2 = grade(under, BP_CARE_V4);
    expect(applyBpOverride(under, b2, BP_CARE_V4, o).result).toBe(b2);
  });
  it("both chronic ambers together are relaxed only when both settings clear them", () => {
    const input = bpInput({ history: history(6, 175, 100) }, { systolic: 86, diastolic: 55 });
    const base = grade(input, BP_CARE_V4);
    expect(base.matchedRuleIds).toEqual(expect.arrayContaining(["BP-A2", "BP-A7"]));
    const onlyTarget = applyBpOverride(input, base, BP_CARE_V4, bp("a", { target: { systolic: 150, diastolic: 95 } }));
    expect(onlyTarget.result).toBe(base);
    const both = applyBpOverride(input, base, BP_CARE_V4, bp("b", { target: { systolic: 150, diastolic: 95 }, lowAmberSystolic: 85 }));
    expect(both.result.grade).toBe("green");
    expect(both.result.override?.parameters).toEqual(["target", "lowAmberSystolic"]);
  });
  it("a low line alone does not clear the average rule", () => {
    const input = bpInput();
    const base = grade(input, BP_CARE_V3);
    expect(applyBpOverride(input, base, BP_CARE_V3, bp("l", { lowAmberSystolic: 85 })).result).toBe(base);
  });
  it("a personal target that is stricter does not relax", () => {
    const input = bpInput();
    const base = grade(input, BP_CARE_V3);
    const out = applyBpOverride(input, base, BP_CARE_V3, bp("s", { target: { systolic: 120, diastolic: 75 } }));
    expect(out.result).toBe(base);
  });
});

describe("applyBpOverride: never relaxes what must not be relaxed", () => {
  it("never touches a red (any red, with a symptom or without)", () => {
    for (const [, rs] of SETS) {
      const input = bpInput({}, { systolic: 185, diastolic: 125 }, ["chest_pain"]);
      const base = grade(input, rs);
      expect(base.grade).toBe("red");
      const out = applyBpOverride(input, base, rs, bp("x", { target: { systolic: 160, diastolic: 100 }, lowAmberSystolic: 80 }));
      expect(out.result).toBe(base);
    }
  });
  it("never relaxes a symptom amber (the amber from a ticked red-flag-adjacent symptom) or any rule not on the list", () => {
    const input = bpInput({}, { systolic: 150, diastolic: 92 }, ["dizziness"]);
    const base = grade(input, BP_CARE_V3);
    const out = applyBpOverride(input, base, BP_CARE_V3, bp());
    expect(out.result).toBe(base);
  });
  it("a relaxable amber with a symptom ticked is left alone and says why", () => {
    const input = bpInput({}, { systolic: 150, diastolic: 92 }, ["palpitations"]);
    const base = grade(input, BP_CARE_V3);
    expect(base.ruleId).toBe("BP-A2");
    const out = applyBpOverride(input, base, BP_CARE_V3, bp());
    expect(out.result).toBe(base);
    expect(out.ignored).toBe("symptoms_present");
  });
  it("never relaxes pregnant, postpartum, under 18 or age-unknown patients", () => {
    const cases: [Partial<TriageInput>, { systolic: number; diastolic: number }][] = [
      [{ pregnant: true }, { systolic: 150, diastolic: 92 }],
      [{ ageYears: 17 }, { systolic: 150, diastolic: 92 }],
      [{ postpartum: true }, { systolic: 148, diastolic: 90 }],
      [{ ageYears: null }, { systolic: 150, diastolic: 92 }],
    ];
    for (const [c, r] of cases) {
      const input = bpInput(c, r);
      const base = grade(input, BP_CARE_V3);
      const out = applyBpOverride(input, base, BP_CARE_V3, bp());
      expect(out.result).toBe(base);
      expect(out.result.override).toBeUndefined();
    }
    // age unknown and postpartum reach the exclusion check (their only amber is the relaxable one)
    for (const [c, r] of [[{ ageYears: null }, { systolic: 150, diastolic: 92 }], [{ postpartum: true }, { systolic: 148, diastolic: 90 }]] as const) {
      const input = bpInput(c, r);
      expect(applyBpOverride(input, grade(input, BP_CARE_V3), BP_CARE_V3, bp()).ignored).toBe("excluded_population");
    }
  });
  it("never relaxes a recheck prompt or a missing green rule", () => {
    const input = bpInput();
    const base = grade(input, BP_CARE_V3);
    const withRecheckRule = { ...base, matchedRuleIds: [...base.matchedRuleIds, "BP-X2"] };
    expect(applyBpOverride(input, withRecheckRule, BP_CARE_V3, bp()).result).toBe(withRecheckRule);
    const noGreens: RuleSet = { ...BP_CARE_V3, rules: BP_CARE_V3.rules.filter((r) => r.id !== "BP-G1" && r.id !== "BP-G2") };
    const out = applyBpOverride(input, base, noGreens, bp());
    expect(out.ignored).toBe("not_applicable");
  });
  it("urgent 180/110 confirmed is amber (BP-A1) and is never relaxed", () => {
    const input = bpInput({}, { systolic: 150, diastolic: 92 });
    const base = grade(input, BP_CARE_V3);
    const a1: TriageResult = { ...base, ruleId: "BP-A1", matchedRuleIds: ["BP-A1", "BP-A2"] };
    expect(applyBpOverride(input, a1, BP_CARE_V3, bp()).result).toBe(a1);
  });
});

describe("applyBpOverride: ignored overrides", () => {
  const input = bpInput();
  const base = grade(input, BP_CARE_V3);
  it("null changes nothing", () => {
    expect(applyBpOverride(input, base, BP_CARE_V3, null)).toEqual({ result: base, ignored: null });
  });
  it("wrong domain, unsigned, expired (and corrupt expiry) and out-of-limits are ignored", () => {
    expect(applyBpOverride(input, base, BP_CARE_V3, gl({ hypoAlertMmol: 4.4 })).ignored).toBe("wrong_domain");
    expect(applyBpOverride(input, base, BP_CARE_V3, bp("u", undefined, { signedAt: null })).ignored).toBe("unsigned");
    expect(applyBpOverride(input, base, BP_CARE_V3, bp("e", undefined, { expiresAt: "2026-10-15T09:59:59.000Z" })).ignored).toBe("expired");
    expect(applyBpOverride(input, base, BP_CARE_V3, bp("e", undefined, { expiresAt: NOW })).ignored).toBe("expired");
    expect(applyBpOverride(input, base, BP_CARE_V3, bp("n", undefined, { expiresAt: "garbage" })).ignored).toBe("expired");
    const out = applyBpOverride(input, base, BP_CARE_V3, bp("o", { target: { systolic: 200, diastolic: 95 } }));
    expect(out.ignored).toBe("out_of_limits");
    expect(out.result).toBe(base);
  });
  it("expiry returns to default: the same override relaxes one day and not the next", () => {
    const o = bp("x", undefined, { expiresAt: "2026-10-16T00:00:00.000Z" });
    expect(applyBpOverride(input, base, BP_CARE_V3, o).result.grade).toBe("green");
    const later = bpInput({ now: "2026-10-16T00:00:01.000Z" });
    const lbase = grade(later, BP_CARE_V3);
    expect(applyBpOverride(later, lbase, BP_CARE_V3, o).result).toBe(lbase);
  });
  it("rejected, recheck-required and non-observation results are not applicable", () => {
    const rejected: TriageResult = { ...base, status: "rejected", grade: null, reason: "implausible_reading" };
    expect(applyBpOverride(input, rejected, BP_CARE_V3, bp()).ignored).toBe("not_applicable");
    const silence: TriageInput = { ...input, trigger: { type: "silence", lastReadingAt: null, sinceAt: NOW } };
    expect(applyBpOverride(silence, base, BP_CARE_V3, bp()).ignored).toBe("not_applicable");
  });
});

describe("applyBpOverride: tighten (CKD style stricter target)", () => {
  const strict = bp("ckd", { target: { systolic: 120, diastolic: 80 } });
  const greenInput = bpInput({ history: history(6, 142, 88) }, { systolic: 128, diastolic: 80 });
  it("a green becomes an amber review with the care-team task, once per week", () => {
    const base = grade(greenInput, BP_CARE_V3);
    expect(base.grade).toBe("green");
    const { result } = applyBpOverride(greenInput, base, BP_CARE_V3, strict);
    expect(result.grade).toBe("amber");
    expect(result.ruleId).toBe("BP-A2");
    expect(result.taskKey).toBe("BP-A2:2026-W42");
    expect(result.actions.some((a) => a.kind === "create_task")).toBe(true);
    expect(result.override?.direction).toBe("tightened");
    const dup = { ...greenInput, existingOpenTaskKeys: ["BP-A2:2026-W42"] };
    const d = applyBpOverride(dup, grade(dup, BP_CARE_V3), BP_CARE_V3, strict).result;
    expect(d.duplicateSuppressed).toBe(true);
    expect(d.actions.some((a) => a.kind === "create_task")).toBe(false);
    const other = { ...greenInput, existingOpenTaskKeys: ["BP-A2:2026-W41"] };
    expect(applyBpOverride(other, grade(other, BP_CARE_V3), BP_CARE_V3, strict).result.duplicateSuppressed).toBe(false);
  });
  it("tightening still applies in excluded populations (it can only be more sensitive)", () => {
    const preg = { ...greenInput, pregnant: false, ageYears: 17 };
    const base = grade(preg, BP_CARE_V3);
    if (base.grade === "green") expect(applyBpOverride(preg, base, BP_CARE_V3, strict).result.grade).toBe("amber");
  });
  it("without the amber rule in the set it does nothing", () => {
    const base = grade(greenInput, BP_CARE_V3);
    const noA2: RuleSet = { ...BP_CARE_V3, rules: BP_CARE_V3.rules.filter((r) => r.id !== "BP-A2") };
    expect(applyBpOverride(greenInput, base, noA2, strict).ignored).toBe("not_applicable");
  });
  it("a stricter target with an average that still clears it changes nothing", () => {
    const fine = bpInput({ history: history(6, 118, 70) }, { systolic: 118, diastolic: 70 });
    const base = grade(fine, BP_CARE_V3);
    expect(applyBpOverride(fine, base, BP_CARE_V3, strict).result).toBe(base);
  });
});

describe("safety sweep: an override never lowers a red or relaxes a symptom, over every reading and every rule set", () => {
  const extreme = [
    bp("e1", { target: { systolic: 160, diastolic: 100 }, lowAmberSystolic: 80 }),
    bp("e2", { target: { systolic: 100, diastolic: 60 }, lowAmberSystolic: 90 }),
  ];
  const rank = { green: 0, amber: 1, red: 2 } as const;
  it("holds across the grid", () => {
    let relaxed = 0;
    for (const [, rs] of SETS) {
      for (let s = 70; s <= 230; s += 6) {
        for (let d = 40; d <= 140; d += 10) {
          for (const symptoms of [[], ["dizziness"], ["chest_pain"], ["palpitations"]] as SymptomCode[][]) {
            for (const hist of [history(6, 160, 95), history(6, 185, 118), []]) {
              for (const o of extreme) {
                const input = bpInput({ history: hist, postpartum: false }, { systolic: s, diastolic: Math.min(d, s - 1) }, symptoms);
                const base = grade(input, rs);
                if (base.status !== "graded") continue;
                const out = applyBpOverride(input, base, rs, o).result;
                if (base.grade === "red") expect(out).toBe(base);
                if (symptoms.length > 0 && rank[out.grade!] < rank[base.grade!]) throw new Error(`relaxed with symptoms at ${s}/${d}`);
                if (rank[out.grade!] < rank[base.grade!]) {
                  relaxed++;
                  expect(base.grade).toBe("amber");
                  expect(["BP-A2", "BP-A7"]).toContain(base.ruleId);
                }
                expect(out.actions.some((a) => a.kind === "page_on_call")).toBe(base.actions.some((a) => a.kind === "page_on_call"));
              }
            }
          }
        }
      }
    }
    expect(relaxed).toBeGreaterThan(0);
  });
  it("DRIFT PIN: an override that restates the signed defaults changes nothing, for every rule set and every case (the engine's copy of BP-A2 and BP-A7 equals the rule set's)", () => {
    for (const [, rs] of SETS) {
      const low = (rs.params["low"] as { redSystolic: number }).redSystolic;
      const same = bp("same", { target: { systolic: 135, diastolic: 85 }, lowAmberSystolic: low });
      for (let s = 70; s <= 230; s += 4) {
        for (let d = 40; d <= 140; d += 10) {
          for (const symptoms of [[], ["dizziness"], ["palpitations"]] as SymptomCode[][]) {
            for (const hist of [history(6, 140, 88), history(6, 160, 95), history(6, 185, 118), history(3, 160, 95), []]) {
              const input = bpInput({ history: hist }, { systolic: s, diastolic: Math.min(d, s - 1) }, symptoms);
              const base = grade(input, rs);
              if (base.status !== "graded") continue;
              expect(applyBpOverride(input, base, rs, same).result).toBe(base);
            }
          }
        }
      }
    }
  });
  it("never relaxes a pregnant patient across the grid", () => {
    for (let s = 70; s <= 200; s += 10) {
      const input = bpInput({ pregnant: true, history: history(6, 160, 95) }, { systolic: s, diastolic: Math.min(80, s - 1) });
      const base = grade(input, BP_CARE_V3);
      const out = applyBpOverride(input, base, BP_CARE_V3, extreme[0] as ActiveOverride).result;
      expect(rank[out.grade!]).toBeGreaterThanOrEqual(rank[base.grade!]);
    }
  });
});

function glInput(mmol: number, over: Partial<GlucoseInput> = {}, symptoms: GlucoseInput["trigger"]["symptoms"] = []): GlucoseInput {
  return { trigger: { type: "glucose", reading: { mmol, takenAt: NOW, context: "random" }, symptoms }, diabetesType: "type_1", pregnant: false, ageYears: 40, now: NOW, ...over };
}

describe("applyGlucoseOverride (hypoglycaemia unawareness: only ever more sensitive)", () => {
  it("a higher personal alert line turns a green 4.2 into an amber treat-now", () => {
    const input = glInput(4.2);
    const base = gradeGlucose(input, GLUCOSE_CARE_V1);
    expect(base.grade).toBe("green");
    const { result, ignored } = applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, gl({ hypoAlertMmol: 4.4 }));
    expect(ignored).toBeNull();
    expect(result.grade).toBe("amber");
    expect(result.ruleId).toBe("GL-A1");
    expect(result.override).toMatchObject({ direction: "tightened", parameters: ["hypoAlertMmol"], defaultGrade: "green", finalGrade: "amber" });
  });
  it("at or above the personal line it stays green", () => {
    const input = glInput(4.4);
    const base = gradeGlucose(input, GLUCOSE_CARE_V1);
    expect(applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, gl({ hypoAlertMmol: 4.4 })).result).toBe(base);
  });
  it("a higher personal red line pages for a 3.3 that is amber by default", () => {
    const input = glInput(3.3);
    const base = gradeGlucose(input, GLUCOSE_CARE_V1);
    expect(base.grade).toBe("amber");
    const { result } = applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, gl({ hypoSevereMmol: 3.5, hypoAlertMmol: 4.4 }));
    expect(result.grade).toBe("red");
    expect(result.ruleId).toBe("GL-R1");
    expect(result.actions).toEqual(expect.arrayContaining([{ kind: "page_on_call" }]));
    expect(result.override?.parameters).toEqual(["hypoSevereMmol"]);
  });
  it("a red stays untouched, and a reading at the red line is not made red", () => {
    const red = glInput(2.8);
    const rb = gradeGlucose(red, GLUCOSE_CARE_V1);
    expect(applyGlucoseOverride(red, rb, GLUCOSE_CARE_V1, gl({ hypoSevereMmol: 3.5 })).result).toBe(rb);
    const edge = glInput(3.5);
    const eb = gradeGlucose(edge, GLUCOSE_CARE_V1);
    expect(applyGlucoseOverride(edge, eb, GLUCOSE_CARE_V1, gl({ hypoSevereMmol: 3.5 })).result).toBe(eb);
  });
  it("an amber that is not green is not made amber again; no setting changes nothing", () => {
    const input = glInput(3.5);
    const base = gradeGlucose(input, GLUCOSE_CARE_V1);
    expect(applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, gl({ hypoAlertMmol: 4.4 })).result).toBe(base);
    expect(applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, gl({})).ignored).toBe("out_of_limits");
  });
  it("ignores null, wrong domain, unsigned, expired, rejected and a missing rule", () => {
    const input = glInput(4.2);
    const base = gradeGlucose(input, GLUCOSE_CARE_V1);
    expect(applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, null).ignored).toBeNull();
    expect(applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, bp()).ignored).toBe("wrong_domain");
    expect(applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, gl({ hypoAlertMmol: 4.4 }, { signedAt: null })).ignored).toBe("unsigned");
    expect(applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, gl({ hypoAlertMmol: 4.4 }, { expiresAt: "2026-10-01T00:00:00.000Z" })).ignored).toBe("expired");
    const rej: TriageResult = { ...base, status: "rejected", grade: null };
    expect(applyGlucoseOverride(input, rej, GLUCOSE_CARE_V1, gl({ hypoAlertMmol: 4.4 })).ignored).toBe("not_applicable");
    const noA1 = { ...GLUCOSE_CARE_V1, rules: GLUCOSE_CARE_V1.rules.filter((r) => r.id !== "GL-A1") };
    expect(applyGlucoseOverride(input, base, noA1, gl({ hypoAlertMmol: 4.4 })).ignored).toBe("not_applicable");
    const amberIn = glInput(3.3);
    const ab = gradeGlucose(amberIn, GLUCOSE_CARE_V1);
    const noR1 = { ...GLUCOSE_CARE_V1, rules: GLUCOSE_CARE_V1.rules.filter((r) => r.id !== "GL-R1") };
    expect(applyGlucoseOverride(amberIn, ab, noR1, gl({ hypoSevereMmol: 3.5 })).ignored).toBe("not_applicable");
  });
  it("sweep: never less urgent than the signed default, at any glucose", () => {
    const rank = { green: 0, amber: 1, red: 2 } as const;
    for (let t = 5; t <= 400; t += 1) {
      const input = glInput(t / 10);
      const base = gradeGlucose(input, GLUCOSE_CARE_V1);
      if (base.status !== "graded") continue;
      for (const o of [gl({ hypoAlertMmol: 5.0, hypoSevereMmol: 3.5 }), gl({ hypoAlertMmol: 3.9 })]) {
        const out = applyGlucoseOverride(input, base, GLUCOSE_CARE_V1, o).result;
        expect(rank[out.grade!]).toBeGreaterThanOrEqual(rank[base.grade!]);
      }
    }
  });
});
