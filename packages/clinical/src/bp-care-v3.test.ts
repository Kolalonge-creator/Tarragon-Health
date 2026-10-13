import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { BP_CARE_V1, BP_CARE_V3, expectationWithDefaults, grade, summarise, type ResultSummary, type TriageInput } from "./index";

// BP_CARE_V1 is the file's original name; since S11c it holds rule set version 2 (the CMO's decisions of 2026-10-05).
const V2 = BP_CARE_V1;

interface FixtureCase {
  id: string;
  title: string;
  input: TriageInput;
  expect: Partial<ResultSummary>;
}
const fixtures: { cases: FixtureCase[] } = JSON.parse(readFileSync(new URL("../fixtures/safety-cases.json", import.meta.url), "utf8"));
const byId = (id: string): FixtureCase => fixtures.cases.find((c) => c.id === id)!;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown> & { version?: number; params: Record<string, unknown> };

describe("bp_care_triage v3 (decision S11-1: v2 plus a 7 day silence line)", () => {
  it("differs from v2 only in the version and the silence line", () => {
    const a = json(V2);
    const b = json(BP_CARE_V3);
    expect(a.version).toBe(2);
    expect(b.version).toBe(3);
    expect((a.params.silence as { days: number }).days).toBe(5);
    expect((b.params.silence as { days: number }).days).toBe(7);
    delete a.version;
    delete b.version;
    delete a.params.silence;
    delete b.params.silence;
    expect(b).toEqual(a);
  });

  it("keeps the code and is still a draft until the CMO approves it", () => {
    expect(BP_CARE_V3.code).toBe(V2.code);
    expect(BP_CARE_V3.status).toBe("draft");
  });

  it("is what the server derives from the stored v2 (the same two edits applied to the v2 rules as S11f last wrote them)", () => {
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    // The v2 row was seeded by S11c and rewritten by S11f (it added the postpartum window while v2 was still a draft); S11f's JSON is what was approved.
    const seedSql = readFileSync(new URL(readdirSync(dir).find((f) => f.endsWith("_s11f_recheck_backup_push_and_postpartum_window.sql"))!, dir), "utf8");
    const seed = json(JSON.parse(/\$rules_json\$([\s\S]*?)\$rules_json\$/.exec(seedSql)![1]!));
    seed.version = 3;
    (seed.params.silence as { days: number }).days = 7;
    expect(seed).toEqual(json(BP_CARE_V3));
    const mig = readFileSync(new URL(readdirSync(dir).find((f) => f.endsWith("_s11c_bp_care_triage_v3.sql"))!, dir), "utf8");
    expect(mig).toContain("jsonb_set(jsonb_set(rules, '{version}', '3'::jsonb), '{params,silence,days}', '7'::jsonb)");
    expect(mig).toContain("where code = 'bp_care_triage' and version = 2");
  });

  it("grades every safety fixture the same as v2 except SC-07a and SC-07c, the silence cases at 6 full days", () => {
    // SC-07b is checked a day later (7 days), so it still creates the task under v3.
    const changed = new Set(["SC-07a", "SC-07c"]);
    for (const c of fixtures.cases) {
      if (changed.has(c.id)) continue;
      expect(summarise(grade(c.input, BP_CARE_V3))).toEqual(expectationWithDefaults(c.expect));
    }
  });

  it("6 days of silence is now below the line (v2 acted here, v3 does not)", () => {
    const created = byId("SC-07a");
    expect(grade(created.input, V2).actions.map((a) => a.kind)).toContain("create_task");
    const open = byId("SC-07c");
    expect(grade(open.input, V2)).toMatchObject({ ruleId: "BP-A5", duplicateSuppressed: true });
    for (const c of [created, open]) {
      const r = grade(c.input, BP_CARE_V3);
      expect(r.grade).toBe("green");
      expect(r.actions).toEqual([]);
    }
  });

  it("7 days of silence creates the silence task, for a patient with readings and for one who never logged", () => {
    const sevenDays: TriageInput = { ...byId("SC-07a").input, now: "2026-10-06T09:00:00Z" };
    expect(summarise(grade(sevenDays, BP_CARE_V3))).toMatchObject({ grade: "amber", ruleId: "BP-A5", actions: ["create_task:silence_check"] });
    const never = byId("SC-07f");
    expect(summarise(grade(never.input, BP_CARE_V3))).toEqual(expectationWithDefaults(never.expect));
  });

  it("only a care-pack patient can get the silence task, as before", () => {
    const e = byId("SC-07e");
    expect(summarise(grade({ ...e.input, now: "2026-10-20T09:00:00Z" }, BP_CARE_V3)).grade).toBe("green");
  });

  it("keeps the CMO's v2 decisions: a reading of 200/130 or more with no symptom is not red (medicine, rest and a 2 hour recheck)", () => {
    const reading = { systolic: 205, diastolic: 135, takenAt: "2026-10-05T09:00:00Z" };
    const input: TriageInput = {
      trigger: { type: "observation", reading, symptoms: [], symptomsAnswered: true },
      history: [],
      target: { systolic: 135, diastolic: 85 },
      pathway: { state: "self_guided" },
      pregnant: false,
      ageYears: 45,
      now: "2026-10-05T09:00:00Z",
    };
    expect(grade(input, BP_CARE_V3)).toEqual({ ...grade(input, V2), ruleSet: { code: "bp_care_triage", version: 3 } });
  });
});
