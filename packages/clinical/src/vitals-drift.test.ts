import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { getProposedConfig } from "@tarragon/shared";
import { VITALS_WORDING_CODES } from "@tarragon/i18n";
import { BP_CARE_V1, validateRuleSet, validateVitalsRuleSet, VITALS_CARE_V1 } from "./index";

const migrations = new URL("../../../supabase/migrations/", import.meta.url);
const file = (suffix: string) => readFileSync(new URL(readdirSync(migrations).find((f) => f.endsWith(suffix))!, migrations), "utf8");
const p = VITALS_CARE_V1.params;

describe("vitals_care_triage v1: the seeded draft is the bundled rule set", () => {
  const seedSql = file("_build_vitals_care_triage_v1_draft.sql");
  const seed = JSON.parse(/\$rules_json\$([\s\S]*?)\$rules_json\$/.exec(seedSql)![1]!) as unknown;

  it("the JSON in the migration equals VITALS_CARE_V1 exactly (drift test)", () => {
    expect(seed).toEqual(JSON.parse(JSON.stringify(VITALS_CARE_V1)));
  });

  it("is a draft, unsigned: the migration never approves it or confirms its task type", () => {
    expect(VITALS_CARE_V1.status).toBe("draft");
    const code = seedSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).toContain("'draft'");
    expect(code).not.toMatch(/approved_by|approved_at|status\s*=\s*'approved'/);
    expect(code).not.toMatch(/confirmed_at\s*=|confirmed_by\s*=|confirm_task_type/);
    expect(seedSql).toContain("needs_confirmation");
  });

  it("is a valid rule set and answers every task key with a task type the migration creates or that already exists", () => {
    expect(validateVitalsRuleSet(VITALS_CARE_V1)).toEqual([]);
    const keys = new Set(VITALS_CARE_V1.rules.flatMap((r) => r.actions.flatMap((a) => (a.kind === "create_task" ? [a.task] : []))));
    expect([...keys].sort()).toEqual(["amber_vitals_review", "referral_review"]);
    expect(seedSql).toContain("array['amber_vitals_review']");
  });

  it("the migrations, the proofs and the manifest agree on file names", () => {
    expect(file("_build_vitals_triage_wiring.sql")).toContain("triage_context_for_vitals_observation");
    expect(file("_build_vitals_shadow_divergence.sql")).toContain("triage_vitals_shadow_divergence");
    expect(file("_build_red_page_dedupe_key.sql")).toContain("red_page_dedupe_claims");
    const manifest = readFileSync(new URL("../../db/tests/ci.manifest", import.meta.url), "utf8");
    for (const proof of ["build_vitals_triage_wiring.sql", "build_vitals_shadow_divergence.sql", "build_red_page_dedupe_key.sql"]) expect(manifest).toContain(proof);
  });
});

describe("the single-reading vitals bands: four places, one set of numbers", () => {
  const registry = getProposedConfig("triage.single_reading_vitals_bands").value as Record<string, unknown>;

  it("the PROPOSED config entry equals the rule set params, and is proposed, owned by the CMO, never confirmed by a build", () => {
    expect({ validation: registry.validation, minAdultAgeYears: registry.minAdultAgeYears, pulse: registry.pulse, spo2: registry.spo2, temperature: registry.temperature }).toEqual({
      validation: p.validation,
      minAdultAgeYears: p.minAdultAgeYears,
      pulse: p.pulse,
      spo2: p.spo2,
      temperature: p.temperature,
    });
    const entry = getProposedConfig("triage.single_reading_vitals_bands");
    expect([entry.owner, entry.status]).toEqual(["CMO", "proposed"]);
  });

  it("the amber review due time in the config is the due time every amber task rule uses", () => {
    const due = VITALS_CARE_V1.rules.flatMap((r) => r.actions.flatMap((a) => (a.kind === "create_task" && a.task === "amber_vitals_review" ? [a.dueMinutes] : [])));
    expect(due.length).toBeGreaterThan(0);
    for (const d of due) expect(d).toBe(registry.amberReviewDueMinutes);
  });

  it("the phone's device bands (vitals.device_red_rules) say the same", () => {
    const d = getProposedConfig("vitals.device_red_rules").value as {
      pulse_bpm: Record<string, number>;
      spo2_pct: Record<string, number>;
      temperature_c: Record<string, number>;
    };
    expect(d.pulse_bpm).toEqual({
      emergency_at_or_below: p.pulse.emergencyAtOrBelow,
      emergency_at_or_above: p.pulse.emergencyAtOrAbove,
      red_at_or_below: p.pulse.redAtOrBelow,
      red_at_or_above: p.pulse.redAtOrAbove,
      amber_at_or_below: p.pulse.amberAtOrBelow,
      amber_at_or_above: p.pulse.amberAtOrAbove,
    });
    expect(d.spo2_pct).toEqual({ emergency_below: p.spo2.emergencyBelow, red_at_or_below: p.spo2.redAtOrBelow, amber_at_or_below: p.spo2.amberAtOrBelow });
    expect(d.temperature_c).toEqual({
      emergency_at_or_above: p.temperature.emergencyAtOrAbove,
      emergency_below: p.temperature.emergencyBelow,
      red_at_or_above: p.temperature.redAtOrAbove,
      amber_at_or_above: p.temperature.amberAtOrAbove,
    });
  });

  it("the older SQL classifiers (the live parity target) use the same numbers", () => {
    const pulse = file("_pulse_red_flag_engine.sql");
    const spo2 = file("_spo2_red_flag_engine.sql");
    const temp = file("_temperature_red_flag_engine.sql");
    const squash = (s: string) => s.replace(/\s+/g, " ");
    expect(squash(pulse)).toContain(`when p_pulse_bpm <= ${p.pulse.emergencyAtOrBelow} or p_pulse_bpm >= ${p.pulse.emergencyAtOrAbove} then 'emergency'`);
    expect(squash(pulse)).toContain(`when p_pulse_bpm <= ${p.pulse.redAtOrBelow} or p_pulse_bpm >= ${p.pulse.redAtOrAbove} then 'red'`);
    expect(squash(pulse)).toContain(`when p_pulse_bpm <= ${p.pulse.amberAtOrBelow} or p_pulse_bpm >= ${p.pulse.amberAtOrAbove} then 'amber'`);
    expect(squash(spo2)).toContain(`when p_spo2_pct < ${p.spo2.emergencyBelow} then 'emergency'`);
    expect(squash(spo2)).toContain(`when p_spo2_pct <= ${p.spo2.redAtOrBelow} then 'red'`);
    expect(squash(spo2)).toContain(`when p_spo2_pct <= ${p.spo2.amberAtOrBelow} then 'amber'`);
    expect(squash(temp)).toContain(`when p_temperature_c >= ${p.temperature.emergencyAtOrAbove.toFixed(1)} or p_temperature_c < ${p.temperature.emergencyBelow.toFixed(1)} then 'emergency'`);
    expect(squash(temp)).toContain(`when p_temperature_c >= ${p.temperature.redAtOrAbove.toFixed(1)} then 'red'`);
    expect(squash(temp)).toContain(`when p_temperature_c >= ${p.temperature.amberAtOrAbove.toFixed(1)} then 'amber'`);
  });

  it("a number moved in one place only is caught (sabotage)", () => {
    const moved = { ...p.pulse, emergencyAtOrAbove: 151 };
    expect(moved).not.toEqual(registry.pulse);
  });
});

describe("vitals wording and notification safety", () => {
  const codes = new Set<string>([p.rejected.explanationKey]);
  for (const r of VITALS_CARE_V1.rules) {
    codes.add(r.explanationKey);
    for (const a of r.actions) if (a.kind === "show_emergency_guidance" || a.kind === "show_message") codes.add(a.code);
  }

  it("every message code a rule can return has wording in the unsigned wording file, and the file holds no other code", () => {
    expect([...codes].sort()).toEqual([...VITALS_WORDING_CODES].sort());
  });

  it("uses no code that the shared triage catalogue or the audio manifest would voice (the VIT- codes have their own file and no recording)", () => {
    for (const code of codes) expect(code).toMatch(/^VIT-/);
  });

  it("the notification for a task names no condition and no reading (INV-07): the same neutral key as blood pressure and glucose", () => {
    const keys = new Set(VITALS_CARE_V1.rules.flatMap((r) => r.actions.flatMap((a) => (a.kind === "create_task" ? [a.notifyKey] : []))));
    expect([...keys]).toEqual(["notify.triage.task_created"]);
  });
});

/** The vitals validator and the blood pressure validator enforce the same shared invariants: each mutation below must be refused by BOTH. */
describe("the vitals and blood pressure validators enforce the same shared invariants", () => {
  type Mut = Record<string, unknown> & { rules: Array<Record<string, unknown>> };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const first = (set: Mut, grade: string) => set.rules.findIndex((r) => r["grade"] === grade);
  const mutations: Array<[string, (set: Mut) => void]> = [
    ["a red rule without the page", (s) => { s.rules[first(s, "red")]!["actions"] = [{ kind: "show_emergency_guidance", code: "X" }]; }],
    ["a red rule without the guidance", (s) => { s.rules[first(s, "red")]!["actions"] = [{ kind: "page_on_call" }]; }],
    ["a duplicate rule id", (s) => { s.rules[1]!["id"] = s.rules[0]!["id"]; }],
    ["an unknown field in a condition", (s) => { s.rules[0]!["when"] = { field: "nope", op: "gt", value: 1 }; }],
    ["an unknown operator", (s) => { s.rules[0]!["when"] = { field: "age", op: "approx", value: 1 }; }],
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
    const vt = clone(VITALS_CARE_V1) as unknown as Mut;
    mutate(bp);
    mutate(vt);
    expect(validateRuleSet(bp).length).toBeGreaterThan(0);
    expect(validateVitalsRuleSet(vt).length).toBeGreaterThan(0);
  });
  it("both accept the shipped sets", () => {
    expect(validateRuleSet(BP_CARE_V1)).toEqual([]);
    expect(validateVitalsRuleSet(VITALS_CARE_V1)).toEqual([]);
  });
});
