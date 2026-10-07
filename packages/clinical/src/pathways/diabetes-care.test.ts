import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import {
  DIABETES_CARE_V1,
  buildDiabetesCareRuleSet,
  buildGlucoseFacts,
  gradePathway,
  loadGlucoseConfig,
  pathwayMessageKeyFor,
  validatePathwayRuleSet,
  type GlucoseFactsInput,
  type PathwayRuleSet,
} from "./index";

const NOW = "2026-10-07T10:00:00Z";
const catalogue = en as Record<string, string>;

function grade(over: Partial<GlucoseFactsInput> & { mmol: number }, ruleSet: PathwayRuleSet = DIABETES_CARE_V1, open: string[] = []) {
  const { mmol, ...rest } = over;
  const facts = buildGlucoseFacts({
    latest: { mmol, takenAt: NOW, events: rest.latest?.events },
    history: [],
    ketoneMmol: null,
    ketoneUrine: null,
    insulinOrSulfonylurea: null,
    now: NOW,
    ...rest,
  });
  return gradePathway({ facts, readingAt: NOW, now: NOW, existingOpenTaskKeys: open }, ruleSet);
}

describe("diabetes_care_triage: the acceptance test (spec 13.2, decision Q5)", () => {
  it("glucose 2.8 mmol/L with confusion is red and pages on-call", () => {
    const r = grade({ mmol: 2.8, latest: { mmol: 2.8, takenAt: NOW, events: ["confusion"] } });
    expect(r.grade).toBe("red");
    expect(r.actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["page_on_call", "show_emergency_guidance"]));
    expect(r.matchedRuleIds).toEqual(expect.arrayContaining(["DM-R1", "DM-R2"]));
  });

  it("SABOTAGE: with the red rules removed the same input no longer pages (the test discriminates)", () => {
    const sabotaged: PathwayRuleSet = { ...DIABETES_CARE_V1, rules: DIABETES_CARE_V1.rules.filter((r) => r.grade !== "red") };
    const r = grade({ mmol: 2.8, latest: { mmol: 2.8, takenAt: NOW, events: ["confusion"] } }, sabotaged);
    expect(r.grade).not.toBe("red");
    expect(r.actions.map((a) => a.kind)).not.toContain("page_on_call");
  });

  it("SABOTAGE: with only the severe-low line removed, a symptomatic 3.5 is still red through DM-R2 but an asymptomatic 2.8 is not", () => {
    const noR1: PathwayRuleSet = { ...DIABETES_CARE_V1, rules: DIABETES_CARE_V1.rules.filter((r) => r.id !== "DM-R1") };
    expect(grade({ mmol: 3.5, latest: { mmol: 3.5, takenAt: NOW, events: ["seizure"] } }, noR1).grade).toBe("red");
    // with the line removed an asymptomatic 2.8 falls through every rule: the failure is silent, which is why the red rule is tested by name
    expect(grade({ mmol: 2.8 }, noR1).grade).not.toBe("red");
  });

  it.each(["confusion", "seizure", "unresponsive", "needed_help"] as const)("%s at 3.8 mmol/L is red", (event) => {
    const r = grade({ mmol: 3.8, latest: { mmol: 3.8, takenAt: NOW, events: [event] } });
    expect(r.grade).toBe("red");
    expect(r.actions.some((a) => a.kind === "page_on_call")).toBe(true);
  });

  it("a danger event at 3.9 or above is NOT a hypoglycaemia red (no reading below the line)", () => {
    expect(grade({ mmol: 3.9, latest: { mmol: 3.9, takenAt: NOW, events: ["confusion"] } }).grade).toBe("green");
  });

  it("below 3.0 is red with no symptom at all", () => {
    expect(grade({ mmol: 2.9 }).grade).toBe("red");
    expect(grade({ mmol: 3.0 }).grade).toBe("amber");
  });

  it("3.0 to 3.9 without a danger event is amber with the 15 g advice and a hypo_follow_up task", () => {
    const r = grade({ mmol: 3.5 });
    expect(r.grade).toBe("amber");
    expect(r.actions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "show_message", code: "PW-DM-LOW" }), expect.objectContaining({ kind: "create_task", task: "hypo_follow_up" })]));
    expect(r.actions.some((a) => a.kind === "page_on_call")).toBe(false);
    expect(catalogue[pathwayMessageKeyFor("PW-DM-LOW")!.body]).toMatch(/15 g/);
  });

  it("insulin or sulfonylurea use, or not knowing, tightens the task due time; only a known no loosens it", () => {
    const cfg = loadGlucoseConfig().value;
    const due = (v: boolean | null): number => {
      const t = grade({ mmol: 3.5, insulinOrSulfonylurea: v }).actions.find((a) => a.kind === "create_task");
      return t && t.kind === "create_task" ? t.dueMinutes : -1;
    };
    expect(due(true)).toBe(cfg.insulinOrSulfonylureaDueMinutes);
    expect(due(null)).toBe(cfg.insulinOrSulfonylureaDueMinutes);
    expect(due(false)).toBe(cfg.otherHypoFollowUpDueMinutes);
    expect(due(true)).toBeLessThan(due(false));
  });

  it("high glucose with raised ketones is red (suspected DKA) and pages", () => {
    const r = grade({ mmol: 19, ketoneMmol: 3.4 });
    expect(r.grade).toBe("red");
    expect(r.explanationKey).toBe("PW-DM-DKA");
  });

  it("very high glucose, raised ketones alone and moderate ketones are amber reviews", () => {
    expect(grade({ mmol: 24 }).grade).toBe("amber");
    expect(grade({ mmol: 8, ketoneMmol: 3.1 }).grade).toBe("amber");
    expect(grade({ mmol: 8, ketoneUrine: "small" }).ruleId).toBe("DM-A8");
  });

  it("two serious lows in the window raise a medication-review task; one does not", () => {
    const history = [{ mmol: 2.7, takenAt: "2026-10-01T08:00:00Z" }, { mmol: 3.4, takenAt: "2026-10-02T08:00:00Z", events: ["needed_help"] as const }];
    const r = grade({ mmol: 8, history });
    expect(r.ruleId).toBe("DM-A5");
    expect(grade({ mmol: 8, history: history.slice(0, 1) }).ruleId).toBe("DM-G1");
    // an old serious low outside the review window does not count
    expect(grade({ mmol: 8, history: [{ mmol: 2.7, takenAt: "2026-07-01T08:00:00Z" }] }).ruleId).toBe("DM-G1");
  });

  it("a pattern of highs, with a relax-only individual target, is amber; the override never lowers the line", () => {
    const history = [15, 16, 14.5].map((mmol, i) => ({ mmol, takenAt: `2026-10-0${i + 3}T08:00:00Z` }));
    expect(grade({ mmol: 8, history }).ruleId).toBe("DM-A6");
    expect(grade({ mmol: 8, history, persistentHighOverride: 17 }).ruleId).not.toBe("DM-A6");
    expect(grade({ mmol: 8, history, persistentHighOverride: 5 }).ruleId).toBe("DM-A6");
  });

  it("recurrent lows are amber", () => {
    const history = [{ mmol: 3.5, takenAt: "2026-10-05T08:00:00Z" }];
    expect(grade({ mmol: 3.6, history }).matchedRuleIds).toContain("DM-A7");
  });

  it("a duplicate task is suppressed and reported, not silently dropped", () => {
    const first = grade({ mmol: 3.5 });
    const second = grade({ mmol: 3.5 }, DIABETES_CARE_V1, [first.taskKey as string]);
    expect(second.duplicateSuppressed).toBe(true);
    expect(second.actions.some((a) => a.kind === "create_task")).toBe(false);
  });

  it("an ordinary reading is green with no reassurance rule and no task", () => {
    const r = grade({ mmol: 6.2 });
    expect(r.grade).toBe("green");
    expect(r.actions).toEqual([]);
  });

  it("a missing reading never fires a rule (missing data is not safe, it is not graded)", () => {
    const r = gradePathway({ facts: { "glucose.mmol": null }, readingAt: NOW, now: NOW }, DIABETES_CARE_V1);
    expect(r.matchedRuleIds).toEqual([]);
  });

  it("rejects an unreadable time and an invalid rule set instead of grading half way", () => {
    expect(gradePathway({ facts: {}, readingAt: "nope", now: NOW }, DIABETES_CARE_V1).reason).toBe("invalid_input");
    const bad = { ...DIABETES_CARE_V1, rules: [] } as PathwayRuleSet;
    expect(gradePathway({ facts: {}, readingAt: NOW, now: NOW }, bad).reason).toBe("invalid_rule_set");
  });
});

describe("diabetes_care_triage: shape and safety properties", () => {
  it("is a DRAFT built from the config in force, and valid", () => {
    expect(DIABETES_CARE_V1.status).toBe("draft");
    expect(validatePathwayRuleSet(DIABETES_CARE_V1)).toEqual([]);
    const cfg = loadGlucoseConfig();
    expect(DIABETES_CARE_V1.params.severeHypo).toBe(cfg.value.severeHypo);
    expect(DIABETES_CARE_V1.params.hypoAlert).toBe(cfg.value.hypoAlert);
  });

  it("no rule references an insulin dose, a medicine or a titration (decision Q8, Part C)", () => {
    const text = JSON.stringify(DIABETES_CARE_V1.rules);
    expect(text).not.toMatch(/units?\b|\bdose\b|titrat|metformin|sulfonylurea_dose|insulin_dose|prescri/i);
    // the only mention of insulin in a rule is the neutral treatment fact that TIGHTENS a follow-up
    expect(text.match(/insulin/gi)?.length ?? 0).toBeGreaterThan(0);
    for (const r of DIABETES_CARE_V1.rules) for (const a of r.actions) expect(["show_message", "show_emergency_guidance", "page_on_call", "create_task"]).toContain(a.kind);
  });

  it("every red rule pages on call (INV-05) and the validator refuses one that does not", () => {
    for (const r of DIABETES_CARE_V1.rules.filter((x) => x.grade === "red")) expect(r.actions.some((a) => a.kind === "page_on_call")).toBe(true);
    const broken: PathwayRuleSet = { ...DIABETES_CARE_V1, rules: DIABETES_CARE_V1.rules.map((r) => (r.id === "DM-R1" ? { ...r, actions: [] } : r)) };
    expect(validatePathwayRuleSet(broken).join()).toMatch(/must page on call/);
  });

  it("every explanation key and message code resolves to English wording with no em dash and no 'your doctor'", () => {
    const codes = new Set<string>();
    for (const r of DIABETES_CARE_V1.rules) {
      codes.add(r.explanationKey);
      for (const a of r.actions) if (a.kind === "show_message" || a.kind === "show_emergency_guidance") codes.add(a.code);
    }
    for (const c of codes) {
      const k = pathwayMessageKeyFor(c);
      expect([c, k === null]).toEqual([c, false]);
      for (const text of [catalogue[k!.title], catalogue[k!.body]]) {
        expect(text?.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/—|your doctor/i);
      }
    }
  });

  it("property: raising urgency inputs never lowers the grade (extra symptom, extra ketone, lower reading)", () => {
    const rank = { green: 1, amber: 2, red: 3 } as const;
    const readings = [2.0, 2.8, 3.0, 3.5, 3.8, 3.9, 5, 9, 11, 14, 19.9, 20, 28];
    for (const mmol of readings) {
      for (const ins of [true, false, null]) {
        const base = grade({ mmol, insulinOrSulfonylurea: ins }).grade as keyof typeof rank;
        for (const events of [["confusion"], ["seizure"], ["unresponsive"], ["needed_help"]] as const) {
          const worse = grade({ mmol, latest: { mmol, takenAt: NOW, events }, insulinOrSulfonylurea: ins }).grade as keyof typeof rank;
          expect(rank[worse]).toBeGreaterThanOrEqual(rank[base]);
        }
        const withKetone = grade({ mmol, ketoneMmol: 3.5, insulinOrSulfonylurea: ins }).grade as keyof typeof rank;
        expect(rank[withKetone]).toBeGreaterThanOrEqual(rank[base]);
      }
    }
  });

  it("parity: the rule set survives the JSON round trip the database stores, with identical results over a grid", () => {
    const stored = JSON.parse(JSON.stringify({ ...DIABETES_CARE_V1 })) as PathwayRuleSet;
    for (const mmol of [2.5, 2.9, 3.0, 3.6, 3.9, 6, 12, 20, 25]) {
      for (const events of [[], ["confusion"], ["needed_help"]] as const) {
        const input = { latest: { mmol, takenAt: NOW, events }, history: [], ketoneMmol: mmol > 11 ? 3.2 : null, ketoneUrine: null, insulinOrSulfonylurea: null, now: NOW } as const;
        const facts = buildGlucoseFacts(input);
        const a = gradePathway({ facts, readingAt: NOW, now: NOW }, DIABETES_CARE_V1);
        const b = gradePathway({ facts, readingAt: NOW, now: NOW }, stored);
        expect(b).toEqual(a);
      }
    }
  });

  it("buildDiabetesCareRuleSet follows a changed config (a number is never typed twice)", () => {
    const cfg = { ...loadGlucoseConfig().value, severeHypo: 3.2 };
    const rs = buildDiabetesCareRuleSet(cfg, 9);
    expect(rs.version).toBe(9);
    expect(rs.params.severeHypo).toBe(3.2);
    const facts = buildGlucoseFacts({ latest: { mmol: 3.1, takenAt: NOW }, history: [], ketoneMmol: null, ketoneUrine: null, insulinOrSulfonylurea: null, now: NOW }, cfg);
    expect(gradePathway({ facts, readingAt: NOW, now: NOW }, rs).grade).toBe("red");
  });
});
