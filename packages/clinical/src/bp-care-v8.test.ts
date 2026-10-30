import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { BP_CARE_V7, BP_CARE_V8, RED_FOLLOW_UP_ACTION, grade, validateRuleSet, type TriageInput } from "./index";

// OQ-551 (owner decision 2026-10-28): bp_care_triage v8 is a DRAFT. Every red rule also creates one follow-up task due in 24 hours. The page is unchanged.
const NOW = "2026-10-05T09:00:00Z";
const reading = (systolic: number, diastolic: number, symptoms: string[] = []): TriageInput =>
  ({
    trigger: { type: "observation", reading: { systolic, diastolic, takenAt: NOW }, symptoms },
    history: [],
    target: { systolic: 135, diastolic: 85 },
    pathway: { state: "self_guided" },
    pregnant: false,
    ageYears: 45,
    now: NOW,
  }) as unknown as TriageInput;

const noVersion = (r: unknown) => JSON.parse(JSON.stringify(r).replace(/"(ruleSetVersion|version)":\d+/g, "\"$1\":0"));

describe("bp_care_triage v8 (a follow-up after a red grade)", () => {
  it("is valid, still a draft, same code, built on v7", () => {
    expect(validateRuleSet(BP_CARE_V8)).toEqual([]);
    expect(BP_CARE_V8.code).toBe("bp_care_triage");
    expect(BP_CARE_V8.status).toBe("draft");
    expect(BP_CARE_V8.version).toBe(8);
  });

  it("differs from v7 only in the version, the note, and the follow-up on each red rule", () => {
    const strip = (r: typeof BP_CARE_V8) => {
      const j = JSON.parse(JSON.stringify(r)) as { version?: number; params: Record<string, unknown>; rules: { grade?: string; actions: unknown[]; taskAnchor?: string }[] };
      delete j.version;
      delete j.params.proposedForCmo;
      for (const rule of j.rules) {
        if (rule.grade === "red") {
          rule.actions = rule.actions.filter((a) => JSON.stringify(a) !== JSON.stringify(RED_FOLLOW_UP_ACTION));
          delete rule.taskAnchor;
        }
      }
      return j;
    };
    const stripV7 = JSON.parse(JSON.stringify(BP_CARE_V7));
    delete stripV7.version;
    delete stripV7.params.proposedForCmo;
    for (const rule of stripV7.rules) if (rule.grade === "red") delete rule.taskAnchor;
    expect(strip(BP_CARE_V8)).toEqual(stripV7);
    expect(Object.keys(BP_CARE_V8.params.proposedForCmo as object)).toContain("redFollowUp");
  });

  it("every red rule keeps its page and gains exactly one 24 hour follow-up; no other rule changes", () => {
    const reds = BP_CARE_V8.rules.filter((r) => r.grade === "red");
    expect(reds.length).toBeGreaterThan(0);
    for (const r of reds) {
      expect({ id: r.id, pages: r.actions.some((a) => a.kind === "page_on_call") }).toEqual({ id: r.id, pages: true });
      expect(r.actions.filter((a) => a.kind === "create_task")).toEqual([RED_FOLLOW_UP_ACTION]);
      expect({ id: r.id, anchored: r.taskAnchor !== undefined }).toEqual({ id: r.id, anchored: true });
    }
    const others = BP_CARE_V8.rules.filter((r) => r.grade !== "red");
    expect(others).toEqual(BP_CARE_V7.rules.filter((r) => r.grade !== "red"));
  });

  it("a red reading with a red-flag symptom is still red and pages, and now also creates one follow-up task", () => {
    const r = grade(reading(190, 120, ["severe_headache"]), BP_CARE_V8);
    expect(r).toMatchObject({ status: "graded", grade: "red" });
    expect(r.actions.map((a) => a.kind)).toEqual(expect.arrayContaining(["show_emergency_guidance", "page_on_call", "create_task"]));
    expect(r.taskKey).toBeTruthy();
    // control: version 7 gave the same page and no task
    const before = grade(reading(190, 120, ["severe_headache"]), BP_CARE_V7);
    expect(before.grade).toBe("red");
    expect(before.actions.map((a) => a.kind)).not.toContain("create_task");
  });

  it("the grade of every safety fixture is the same as under v7 (only the actions of red grades differ)", () => {
    const fixtures = JSON.parse(readFileSync(new URL("../fixtures/safety-cases.json", import.meta.url), "utf8")) as { cases?: { id: string; input: TriageInput }[] } | { id: string; input: TriageInput }[];
    const cases = Array.isArray(fixtures) ? fixtures : (fixtures.cases ?? []);
    expect(cases.length).toBeGreaterThan(20);
    for (const c of cases) {
      const a = grade(c.input, BP_CARE_V7);
      const b = grade(c.input, BP_CARE_V8);
      expect({ id: c.id, status: b.status, grade: "grade" in b ? b.grade : undefined }).toEqual({ id: c.id, status: a.status, grade: "grade" in a ? a.grade : undefined });
      // a case that is not red is graded exactly as before, actions and task key included
      if (!("grade" in a) || a.grade !== "red") expect({ id: c.id, result: noVersion(b) }).toEqual({ id: c.id, result: noVersion(a) });
    }
  });

  it("sabotage: a v8 that dropped the page from a red rule would fail the page check", () => {
    const damaged = BP_CARE_V8.rules.map((r) => (r.grade === "red" ? { ...r, actions: r.actions.filter((a) => a.kind !== "page_on_call") } : r));
    const reds = damaged.filter((r) => r.grade === "red");
    expect(reds.some((r) => !r.actions.some((a) => a.kind === "page_on_call"))).toBe(true);
    expect(validateRuleSet({ ...BP_CARE_V8, rules: damaged }).length).toBeGreaterThan(0);
  });
});
