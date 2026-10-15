import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { en } from "@tarragon/i18n";
import { BP_CARE_V1, GLUCOSE_CARE_V1, GLUCOSE_SYMPTOMS, messageKeyFor, TRIAGE_MESSAGE_KEYS, validateGlucoseRuleSet, validateRuleSet } from "./index";

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(migrations).find((f) => f.endsWith(suffix))!, migrations), "utf8");
const catalogue = en as Record<string, string>;

describe("glucose_care_triage v1: the seeded draft is the bundled rule set", () => {
  const seedSql = file("_r2_glucose_care_triage_v1_draft.sql");
  const seed = JSON.parse(/\$rules_json\$([\s\S]*?)\$rules_json\$/.exec(seedSql)![1]!) as unknown;

  it("the JSON in the migration equals GLUCOSE_CARE_V1 exactly (drift test)", () => {
    expect(seed).toEqual(JSON.parse(JSON.stringify(GLUCOSE_CARE_V1)));
  });

  it("is a draft, unsigned: the migration never approves it", () => {
    expect(GLUCOSE_CARE_V1.status).toBe("draft");
    expect(seedSql).toContain("'draft'");
    expect(seedSql).not.toMatch(/approved_by|approved_at|status\s*=\s*'approved'/);
    expect(seedSql).toContain("needs_confirmation");
  });

  it("is a valid rule set and answers every task key with a task type the migration creates or that already exists", () => {
    expect(validateGlucoseRuleSet(GLUCOSE_CARE_V1)).toEqual([]);
    const keys = new Set(GLUCOSE_CARE_V1.rules.flatMap((r) => r.actions.flatMap((a) => (a.kind === "create_task" ? [a.task] : []))));
    expect([...keys].sort()).toEqual(["referral_review", "urgent_glucose_review"]);
    expect(seedSql).toContain("array['urgent_glucose_review']");
  });

  it("every symptom the rule set names is a symptom the engine knows", () => {
    for (const group of Object.values(GLUCOSE_CARE_V1.params.symptomGroups)) for (const s of group) expect(GLUCOSE_SYMPTOMS).toContain(s);
  });
});

describe("glucose wording and notification safety", () => {
  const codes = new Set<string>([GLUCOSE_CARE_V1.params.rejected.explanationKey, GLUCOSE_CARE_V1.params.rejected.redFlagGuidanceCode]);
  for (const r of GLUCOSE_CARE_V1.rules) {
    codes.add(r.explanationKey);
    for (const a of r.actions) if (a.kind === "show_emergency_guidance" || a.kind === "show_message") codes.add(a.code);
  }

  it("every message code a rule can return has an English title and body", () => {
    for (const code of codes) {
      const keys = messageKeyFor(code);
      expect([code, keys === null]).toEqual([code, false]);
      expect([code, (catalogue[keys!.title] ?? "").length > 0]).toEqual([code, true]);
      expect([code, (catalogue[keys!.body] ?? "").length > 0]).toEqual([code, true]);
    }
  });

  it("uses no code that the audio manifest would be expected to voice (EMG- and TRI- are voiced; glucose wording has no recording until it is signed)", () => {
    for (const code of codes) expect(code).toMatch(/^GLU-/);
    expect(Object.keys(TRIAGE_MESSAGE_KEYS).filter((k) => k.startsWith("GLU-")).sort()).toEqual([...codes].sort().filter((c) => c.startsWith("GLU-")).concat([]).sort());
  });

  it("the notification for a task names no condition and no reading (INV-07): the same neutral key as blood pressure", () => {
    const keys = new Set(GLUCOSE_CARE_V1.rules.flatMap((r) => r.actions.flatMap((a) => (a.kind === "create_task" ? [a.notifyKey] : []))));
    expect([...keys]).toEqual(["notify.triage.task_created"]);
  });

  it("the migrations, the proof and the manifest agree on file names", () => {
    expect(file("_r2_glucose_triage_wiring.sql")).toContain("triage_context_for_glucose_observation");
    const manifest = readFileSync(new URL("../../db/tests/ci.manifest", import.meta.url), "utf8");
    expect(manifest).toContain("r2_glucose_triage_wiring.sql");
  });
});

/**
 * The glucose and blood pressure validators are separate functions (the blood pressure one is shaped around its own parameters). The shared invariants must
 * not drift apart: each mutation below must be refused by BOTH, so loosening one validator without the other fails here.
 */
describe("the two rule set validators enforce the same shared invariants", () => {
  type Mut = Record<string, unknown> & { rules: Array<Record<string, unknown>> };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const first = (set: Mut, grade: string) => set.rules.findIndex((r) => r["grade"] === grade);
  const mutations: Array<[string, (set: Mut) => void]> = [
    ["a red rule without the page", (s) => { s.rules[first(s, "red")]!["actions"] = [{ kind: "show_emergency_guidance", code: "X" }]; }],
    ["a red rule without the guidance", (s) => { s.rules[first(s, "red")]!["actions"] = [{ kind: "page_on_call" }]; }],
    ["a duplicate rule id", (s) => { s.rules[1]!["id"] = s.rules[0]!["id"]; }],
    ["an unknown field in a condition", (s) => { s.rules[0]!["when"] = { field: "nope", op: "gt", value: 1 }; }],
    ["an unknown operator", (s) => { s.rules[0]!["when"] = { field: "pregnant", op: "approx", value: true }; }],
    ["a missing explanation key", (s) => { s.rules[0]!["explanationKey"] = ""; }],
    ["an unknown action kind", (s) => { s.rules[0]!["actions"] = [{ kind: "text_the_patient" }]; }],
    ["a create_task without a due time", (s) => { s.rules[first(s, "amber")]!["actions"] = [{ kind: "create_task", task: "x", notifyKey: "k" }]; s.rules[first(s, "amber")]!["taskAnchor"] = "week"; }],
    ["a create_task without an anchor", (s) => { s.rules[first(s, "amber")]!["actions"] = [{ kind: "create_task", task: "x", dueMinutes: 60, notifyKey: "k" }]; delete s.rules[first(s, "amber")]!["taskAnchor"]; }],
    ["a bad grade", (s) => { s.rules[0]!["grade"] = "blue"; }],
    ["an empty rule list", (s) => { s.rules = []; }],
    ["no code", (s) => { s["code"] = ""; }],
  ];
  it.each(mutations)("both refuse %s", (_name, mutate) => {
    const bp = clone(BP_CARE_V1) as unknown as Mut;
    const gl = clone(GLUCOSE_CARE_V1) as unknown as Mut;
    mutate(bp);
    mutate(gl);
    expect(validateRuleSet(bp).length).toBeGreaterThan(0);
    expect(validateGlucoseRuleSet(gl).length).toBeGreaterThan(0);
  });
  it("both accept the shipped sets", () => {
    expect(validateRuleSet(BP_CARE_V1)).toEqual([]);
    expect(validateGlucoseRuleSet(GLUCOSE_CARE_V1)).toEqual([]);
  });
});
