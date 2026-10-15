import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { GLUCOSE_CARE_V1, GLUCOSE_SIGN_SYMPTOM_TYPE, GLUCOSE_SYMPTOMS, gradeGlucose, type GlucoseInput, type GlucoseSymptomCode } from "./index";

const NOW = "2026-10-13T09:00:00Z";
function input(mmol: number, symptoms: GlucoseSymptomCode[], ketones: GlucoseInput["trigger"]["ketones"] = {}): GlucoseInput {
  return {
    trigger: { type: "glucose", reading: { mmol, takenAt: NOW, context: "random" }, ketones, symptoms },
    diabetesType: "type_2",
    pregnant: false,
    ageYears: 45,
    now: NOW,
  };
}

const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
function mappingMigration(): string {
  const file = readdirSync(MIGRATIONS).filter((f) => f.endsWith("_glucose_signs_context_mapping.sql"));
  expect(file).toHaveLength(1);
  return readFileSync(new URL(file[0], MIGRATIONS), "utf8");
}
/** [sign code, stored type] pairs from the context function's values list. */
function contextPairs(sql: string): string[][] {
  const fn = sql.slice(sql.indexOf("create or replace function public.triage_context_for_glucose_observation"));
  const values = fn.slice(fn.indexOf("join (values"), fn.indexOf("as m(symptom, code)"));
  return [...values.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map((m) => [m[2]!, m[1]!]);
}
/** The stored types the regrade trigger's `not in (...)` list names. */
function regradeList(sql: string): string[] {
  const regrade = sql.slice(sql.indexOf("create or replace function private.emit_glucose_symptom_regrade"), sql.indexOf("create or replace function public.triage"));
  return [...regrade.slice(regrade.indexOf("not in ("), regrade.indexOf("then")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}
/** Every disagreement between the TS table, the context function's list and the trigger's list; empty when all three are the same. */
function mappingDifferences(sql: string): string[] {
  const out: string[] = [];
  const ts = GLUCOSE_SIGN_SYMPTOM_TYPE as Record<string, string>;
  const ctx = Object.fromEntries(contextPairs(sql));
  for (const code of new Set([...Object.keys(ts), ...Object.keys(ctx)])) {
    if (ts[code] !== ctx[code]) out.push(`context list: ${code} is ${ctx[code] ?? "missing"}, table says ${ts[code] ?? "missing"}`);
  }
  const stored = new Set(Object.values(ts));
  const listed = new Set(regradeList(sql));
  for (const t of stored) if (!listed.has(t)) out.push(`trigger list is missing ${t}`);
  for (const t of listed) if (!stored.has(t)) out.push(`trigger list has ${t}, which no sign maps onto`);
  return out;
}
const rule = (i: GlucoseInput) => gradeGlucose(i, GLUCOSE_CARE_V1);

describe("the sign to symptom_type table", () => {
  it("covers every sign the engine reads, once, and no other", () => {
    expect(Object.keys(GLUCOSE_SIGN_SYMPTOM_TYPE).sort()).toEqual([...GLUCOSE_SYMPTOMS].sort());
    expect(new Set(Object.values(GLUCOSE_SIGN_SYMPTOM_TYPE)).size).toBe(GLUCOSE_SYMPTOMS.length);
  });

  it("is exactly the mapping the server migration applies, in both places it is written (file against table)", () => {
    const sql = mappingMigration();
    expect(Object.fromEntries(contextPairs(sql))).toEqual(GLUCOSE_SIGN_SYMPTOM_TYPE);
    expect(regradeList(sql).sort()).toEqual(Object.values(GLUCOSE_SIGN_SYMPTOM_TYPE).sort());
    expect(mappingDifferences(sql)).toEqual([]);
  });

  it("fails when the three copies differ (negative test: a type dropped from the trigger list, from the context list, or a wrong pair)", () => {
    const sql = mappingMigration();
    // the trigger list loses vomiting: the trigger would never re-grade a reading for a sign that arrives after it
    const noRegradeVomiting = sql.replace("'cannot_swallow', 'vomiting', 'abdominal_pain',", "'cannot_swallow', 'abdominal_pain',");
    expect(noRegradeVomiting).not.toEqual(sql);
    expect(mappingDifferences(noRegradeVomiting).join(" ")).toMatch(/vomiting/);
    // the context list loses a pair
    const noPair = sql.replace("('vomiting', 'vomiting'), ", "");
    expect(noPair).not.toEqual(sql);
    expect(mappingDifferences(noPair).join(" ")).toMatch(/vomiting/);
    // the context list maps a sign onto the wrong stored type
    const wrong = sql.replace("('convulsion', 'seizure')", "('pain', 'seizure')");
    expect(wrong).not.toEqual(sql);
    expect(mappingDifferences(wrong).join(" ")).toMatch(/seizure/);
    // a stored type listed in the trigger that no sign maps onto
    const extra = sql.replace("'cannot_swallow', 'vomiting',", "'cannot_swallow', 'nausea', 'vomiting',");
    expect(mappingDifferences(extra).join(" ")).toMatch(/nausea/);
  });

  it("only adds enum values nothing else uses, each in a file of its own", () => {
    const dir = MIGRATIONS;
    const files = readdirSync(dir).filter((f) => f.includes("_glucose_signs_symptom_type_"));
    expect(files).toHaveLength(3);
    for (const f of files) {
      const statements = readFileSync(new URL(f, dir), "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("--"));
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/^alter type public\.symptom_type add value if not exists '[a-z_]+';$/);
    }
  });
});

describe("what each previously unmapped sign does to the engine (the context the server builds, graded by the draft rules)", () => {
  it("cannot swallow, a seizure or being unconscious is red at any glucose (GL-R3)", () => {
    for (const s of ["cannot_swallow", "seizure", "unconscious"] as const) {
      expect([s, rule(input(6, [s])).ruleId]).toEqual([s, "GL-R3"]);
    }
  });
  it("cannot swallow with a low glucose is GL-R2", () => {
    expect(rule(input(3.5, ["cannot_swallow"])).ruleId).toBe("GL-R2");
  });
  it("vomiting or stomach pain with raised ketones is GL-R5", () => {
    expect(rule(input(6, ["vomiting"], { bloodMmol: 2.0 })).ruleId).toBe("GL-R5");
    expect(rule(input(6, ["abdominal_pain"], { bloodMmol: 2.0 })).ruleId).toBe("GL-R5");
  });
  it("vomiting with glucose 20 or more is GL-R7", () => {
    expect(rule(input(21, ["vomiting"])).ruleId).toBe("GL-R7");
  });
  it("stomach pain alone, with no ketones, grades nothing red (no rule reads it on its own)", () => {
    expect(rule(input(6, ["abdominal_pain"])).grade).not.toBe("red");
  });
});
