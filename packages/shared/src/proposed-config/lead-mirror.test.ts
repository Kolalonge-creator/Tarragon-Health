import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s18_lead_rules_v2_48_hour_week.sql"));
  if (!file) throw new Error("S18 lead rules v2 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /lead-rules-v2-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("lead rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("lead.rules mirrors the migration seed", () => {
  it("is identical, so the registry and lead_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("lead.rules").value);
  });

  it("repeats the spec value for max lead patients", () => {
    const rules = getProposedConfig("lead.rules").value as Record<string, unknown>;
    expect(rules.max_lead_patients).toBe(getProposedConfig("clinician.max_lead_patients").value);
  });

  it("only lets a senior doctor tier or above lead, and never the legacy medical officer tier", () => {
    const rules = getProposedConfig("lead.rules").value as Record<string, unknown>;
    expect(["senior_medical_officer", "chief_medical_officer"]).toContain(rules.lead_min_doctor_tier);
  });
});
