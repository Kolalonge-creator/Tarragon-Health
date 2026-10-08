import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import {
  BP_CARE_V1,
  BP_CARE_V3,
  BP_CARE_V4,
  expectationWithDefaults,
  grade,
  summarise,
  validateRuleSet,
  type ResultSummary,
  type RuleSet,
  type SymptomCode,
  type TriageInput,
} from "./index";

// Decision D1 (founder, 2026-10-07, build S85-D1): bp_care_triage version 4 is a DRAFT that asks the emergency-symptom question from 180/120.
// The CMO has NOT signed it. These tests pin what changes, and what must not.

interface FixtureCase {
  id: string;
  title: string;
  input: TriageInput;
  expect: Partial<ResultSummary>;
}
const fixtures: { cases: FixtureCase[] } = JSON.parse(readFileSync(new URL("../fixtures/safety-cases.json", import.meta.url), "utf8"));

const NOW = "2026-10-05T09:00:00Z";
interface Opts {
  symptoms?: SymptomCode[];
  answered?: boolean;
  recheck?: { minutes: number; prev: [number, number] } | "timed_out";
  pregnant?: boolean;
  postpartum?: boolean;
  ageYears?: number;
}
function obs(systolic: number, diastolic: number, o: Opts = {}): TriageInput {
  const recheck =
    o.recheck === undefined
      ? undefined
      : o.recheck === "timed_out"
        ? { kind: "timed_out" as const }
        : {
            kind: "repeat" as const,
            previous: { systolic: o.recheck.prev[0], diastolic: o.recheck.prev[1], takenAt: "2026-10-05T06:55:00Z" },
            minutesSincePrevious: o.recheck.minutes,
          };
  return {
    trigger: {
      type: "observation",
      reading: { systolic, diastolic, takenAt: NOW },
      symptoms: o.symptoms ?? [],
      ...(recheck ? { recheck } : {}),
      ...(o.answered !== undefined ? { symptomsAnswered: o.answered } : {}),
    },
    history: [],
    target: { systolic: 135, diastolic: 85 },
    pathway: { state: "self_guided" },
    pregnant: o.pregnant ?? false,
    ageYears: o.ageYears ?? 45,
    now: NOW,
    ...(o.postpartum ? { postpartum: true } : {}),
  } as TriageInput;
}
const s4 = (i: TriageInput) => summarise(grade(i, BP_CARE_V4));
const s3 = (i: TriageInput) => summarise(grade(i, BP_CARE_V3));

describe("bp_care_triage v4 (decision D1: a draft that asks the symptom question from 180/120)", () => {
  it("is valid, is still a draft, and keeps the code", () => {
    expect(validateRuleSet(BP_CARE_V4)).toEqual([]);
    expect(BP_CARE_V4.code).toBe(BP_CARE_V3.code);
    expect(BP_CARE_V4.status).toBe("draft");
    expect(BP_CARE_V4.version).toBe(4);
  });

  it("differs from v3 only in the version, the extreme line, the note for the CMO and two rule descriptions", () => {
    const strip = (r: RuleSet) => {
      const j = JSON.parse(JSON.stringify(r)) as { version?: number; params: Record<string, unknown>; rules: { id: string; description?: string }[] };
      delete j.version;
      delete j.params.extreme;
      delete j.params.proposedForCmo;
      for (const rule of j.rules) if (rule.id === "BP-X1" || rule.id === "BP-X2") delete rule.description;
      return j;
    };
    expect(strip(BP_CARE_V4)).toEqual(strip(BP_CARE_V3));
    expect(BP_CARE_V4.params.extreme).toEqual({ systolic: 180, diastolic: 120 });
  });

  it("leaves versions 1 to 3 on 200/130: a signed or approved rule set is never edited", () => {
    expect(BP_CARE_V1.params.extreme).toEqual({ systolic: 200, diastolic: 130 });
    expect(BP_CARE_V3.params.extreme).toEqual({ systolic: 200, diastolic: 130 });
    expect(BP_CARE_V3.version).toBe(3);
  });

  it("carries the three open CMO decisions as a PROPOSED note and leaves their parameters where they were", () => {
    const note = BP_CARE_V4.params.proposedForCmo as Record<string, string>;
    expect(Object.keys(note).sort()).toEqual(["recheckWindow", "severeHeadacheIsOneSymptom", "status", "urgentLineIs180Over110"]);
    expect(note.status).toMatch(/Open decisions/);
    // neutral on purpose: an approved row is immutable, so it must not say 'unsigned' forever
    expect(JSON.stringify(BP_CARE_V4)).not.toMatch(/not signed|unsigned|has not signed/i);
    expect(BP_CARE_V4.params.urgent).toEqual({ systolic: 180, diastolic: 110 });
    expect(BP_CARE_V4.params.extremeRecheck).toEqual({ afterMinutes: 120, windowMinutes: 240 });
    expect(BP_CARE_V4.params.symptomGroups.redFlag).toContain("severe_headache");
  });

  it("is what the server derives from the stored v3 row", () => {
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.endsWith("_s85d1_bp_care_triage_v4_draft_180_120.sql"));
    expect(file).toBeDefined();
    const mig = readFileSync(new URL(file!, dir), "utf8");
    expect(mig).toContain("where code = 'bp_care_triage' and version = 3");
    expect(mig).toContain("'draft'");
    expect(mig).toContain('{"systolic": 180, "diastolic": 120}');
    expect(mig).toContain("DRAFT");
    // never approves or signs anything
    expect(mig).not.toMatch(/approve_triage_rule_set\s*\(/);
    expect(mig).not.toMatch(/status\s*=\s*'approved'/);
  });

  describe("every old safety fixture", () => {
    // Exactly the cases whose first reading has a systolic of 180 to 199 (or diastolic 120 to 129) and so now reach the question.
    const changed = new Set(["SC-03a", "SC-03b", "SC-03c", "SC-03d", "SC-03f", "SC-03g", "SC-03h"]);

    it("grades the same under v4 as under v3, except the seven 181/111 and 182/112 cases", () => {
      for (const c of fixtures.cases) {
        if (changed.has(c.id)) continue;
        expect(summarise(grade(c.input, BP_CARE_V4))).toEqual(summarise(grade(c.input, BP_CARE_V3)));
      }
    });

    it("and the same as the fixture file, apart from those seven and the two 6 day silence cases that v3 moved to 7 days (SC-07a, SC-07c)", () => {
      for (const c of fixtures.cases) {
        if (changed.has(c.id) || c.id === "SC-07a" || c.id === "SC-07c") continue;
        expect(summarise(grade(c.input, BP_CARE_V4))).toEqual(expectationWithDefaults(c.expect));
      }
    });

    it("the seven changed cases reach the symptom question first (or add it), and none loses a task it already had", () => {
      for (const id of changed) {
        const c = fixtures.cases.find((x) => x.id === id)!;
        const before = summarise(grade(c.input, BP_CARE_V3));
        const after = summarise(grade(c.input, BP_CARE_V4));
        // the only fixtures that were an amber task in v3 and are the question in v4 are the ones the patient has not answered yet
        expect(c.input.trigger.type === "observation" && c.input.trigger.symptomsAnswered).not.toBe(true);
        if (after.status === "symptom_check_required") {
          expect(after.ruleId).toBe("BP-X1");
          expect(after.actions).toEqual(["ask_symptoms:TRI-008"]);
        } else {
          // SC-03d: never rechecked is still the amber task, and the question is asked as well
          expect(after.grade).toBe("amber");
          expect(after.actions).toEqual(["create_task:urgent_bp_review", "ask_symptoms:TRI-008"]);
        }
        expect(before.ruleId).toMatch(/BP-A1/);
      }
    });
  });

  describe("D1 cases", () => {
    it("179/119 asks no question and behaves as before (the 5 minute repeat)", () => {
      for (const set of [BP_CARE_V3, BP_CARE_V4]) {
        const r = grade(obs(179, 119), set);
        expect(summarise(r)).toMatchObject({ status: "recheck_required", ruleId: "BP-A1W", waitMinutes: 5 });
        expect(r.actions.map((a) => a.kind)).not.toContain("ask_symptoms");
      }
    });

    it("180/120 asks the question first (v3 did not), by either number alone", () => {
      for (const [sys, dia] of [[180, 120], [180, 100], [150, 120], [179, 120], [180, 119]] as const) {
        expect(s4(obs(sys, dia))).toMatchObject({ status: "symptom_check_required", ruleId: "BP-X1", explanationKey: "TRI-008", actions: ["ask_symptoms:TRI-008"] });
      }
      expect(s3(obs(180, 120)).ruleId).not.toBe("BP-X1");
    });

    it("180/120 and 190/120 with a symptom (including a severe headache) are RED with guidance and the on-call page", () => {
      for (const [sys, dia] of [[180, 120], [190, 120]] as const) {
        for (const symptom of ["severe_headache", "chest_pain", "confusion"] as SymptomCode[]) {
          expect(s4(obs(sys, dia, { symptoms: [symptom] }))).toMatchObject({
            status: "graded",
            grade: "red",
            ruleId: "BP-R1",
            explanationKey: "EMG-001",
            actions: ["show_emergency_guidance:EMG-001", "page_on_call"],
          });
        }
      }
    });

    it("a symptom ticked on the form answers the question on its own, with no answer flag", () => {
      expect(s4(obs(190, 120, { symptoms: ["severe_headache"] })).grade).toBe("red");
      expect(s4(obs(190, 120, { symptoms: ["severe_headache"], answered: false })).grade).toBe("red");
    });

    it("180/120 and 190/120 answered with no symptom: take usual medicine, rest, recheck after 2 hours", () => {
      for (const [sys, dia] of [[180, 120], [190, 120]] as const) {
        expect(s4(obs(sys, dia, { answered: true }))).toMatchObject({ status: "recheck_required", ruleId: "BP-X2", explanationKey: "TRI-007", waitMinutes: 120 });
      }
    });

    it("the recheck: still high after 2 hours, or never done, is the amber same-day task (240 minutes); lower is graded on its own", () => {
      const task = { status: "graded", grade: "amber", ruleId: "BP-A1", actions: ["create_task:urgent_bp_review"], dueMinutes: 240 };
      expect(s4(obs(188, 122, { answered: true, recheck: { minutes: 125, prev: [190, 120] } }))).toMatchObject(task);
      expect(s4(obs(190, 120, { answered: true, recheck: "timed_out" }))).toMatchObject(task);
      expect(s4(obs(150, 92, { answered: true, recheck: { minutes: 125, prev: [190, 120] } }))).toMatchObject({ grade: "green", ruleId: "BP-G2" });
      // too soon: the 2 hour wait stays
      expect(s4(obs(190, 120, { answered: true, recheck: { minutes: 6, prev: [190, 120] } }))).toMatchObject({ status: "recheck_required", ruleId: "BP-X2" });
    });

    it("200/130 behaves exactly as before in v4", () => {
      for (const o of [{}, { answered: true }, { symptoms: ["severe_headache"] as SymptomCode[] }, { answered: true, recheck: "timed_out" as const }]) {
        expect(s4(obs(200, 130, o))).toEqual(s3(obs(200, 130, o)));
      }
    });

    it("a low reading is unchanged", () => {
      for (const [sys, dia, o] of [[85, 60, {}], [85, 60, { symptoms: ["fainting"] }], [95, 60, { symptoms: ["dizziness"] }], [120, 78, {}]] as const) {
        expect(s4(obs(sys, dia, o as Opts))).toEqual(s3(obs(sys, dia, o as Opts)));
      }
    });

    it("pregnancy and the 6 weeks after a birth are unchanged, at and around 180/120", () => {
      const cases: TriageInput[] = [
        obs(182, 112, { pregnant: true }),
        obs(180, 120, { pregnant: true }),
        obs(190, 120, { pregnant: true, symptoms: ["severe_headache"] }),
        obs(150, 95, { pregnant: true }),
        obs(142, 92, { pregnant: true, symptoms: ["severe_headache"] }),
        obs(162, 100, { postpartum: true }),
        obs(180, 120, { postpartum: true }),
        obs(150, 95, { postpartum: true }),
        obs(142, 92, { postpartum: true, symptoms: ["severe_headache"] }),
      ];
      for (const c of cases) expect(s4(c)).toEqual(s3(c));
      // Under 18: still routed to a clinician (BP-P2), same grade and task. The adult repeat prompt that rides along becomes the symptom question.
      const minor4 = s4(obs(190, 120, { ageYears: 16 }));
      const minor3 = s3(obs(190, 120, { ageYears: 16 }));
      expect({ ...minor4, actions: [], waitMinutes: null }).toEqual({ ...minor3, actions: [], waitMinutes: null });
      expect(minor4.ruleId).toBe("BP-P2");
      expect(minor4.actions).toEqual(["route_referral:age", "create_task:referral_review", "ask_symptoms:TRI-008"]);
      expect(s4(obs(180, 120, { pregnant: true }))).toMatchObject({ grade: "red", ruleId: "BP-P3" });
      expect(s4(obs(180, 120, { postpartum: true }))).toMatchObject({ grade: "red", ruleId: "BP-P3" });
    });
  });

  describe("never lowers an emergency (property sweep)", () => {
    const rank = (g: string | null) => (g === "red" ? 3 : g === "amber" ? 2 : g === "green" ? 1 : 0);
    const symptomSets: SymptomCode[][] = [[], ["severe_headache"], ["chest_pain"], ["dizziness"], ["fainting"], ["epigastric_pain"]];
    const flags = [{}, { pregnant: true }, { postpartum: true }, { ageYears: 16 }] as Opts[];

    it("for every reading from 60/30 to 260/140 a red under v3 is a red under v4, and no symptomatic grade falls", () => {
      let checked = 0;
      for (let sys = 60; sys <= 260; sys += 5) {
        for (let dia = 30; dia <= Math.min(140, sys); dia += 5) {
          for (const symptoms of symptomSets) {
            for (const f of flags) {
              for (const answered of [undefined, true]) {
                const i = obs(sys, dia, { ...f, symptoms, ...(answered ? { answered } : {}) });
                const a = grade(i, BP_CARE_V3);
                const b = grade(i, BP_CARE_V4);
                checked += 1;
                if (a.grade === "red") {
                  expect(b.grade).toBe("red");
                  expect(b.actions.map((x) => x.kind)).toEqual(expect.arrayContaining(["show_emergency_guidance", "page_on_call"]));
                }
                if (symptoms.length > 0) expect(rank(b.grade)).toBeGreaterThanOrEqual(rank(a.grade));
                // a rejected input stays rejected, and a reading below 180/120 gets nothing new
                if (a.status === "rejected") expect(b.status).toBe("rejected");
                if (sys < 180 && dia < 120) expect(summarise(b)).toEqual(summarise(a));
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(10000);
    });

    it("every reading at or above 180/120 with a red-flag symptom is red under v4 (the question is only for people who have not answered)", () => {
      for (const sys of [180, 185, 199, 200, 240]) {
        for (const dia of [60, 100, 119, 120, 125]) {
          if (dia > sys) continue;
          expect(s4(obs(sys, dia, { symptoms: ["severe_headache"] })).grade).toBe("red");
        }
      }
    });
  });
});
