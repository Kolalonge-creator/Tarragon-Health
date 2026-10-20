import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): { safety: unknown; goals: unknown } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s48a_activity_safety_gate.sql"));
  if (!file) throw new Error("S48a migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /activity-safety-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("activity_safety_config seed not found in the migration");
  return JSON.parse(match[1]);
}

describe("activity config mirrors the migration seed", () => {
  it("the safety rules match the registry entry", () => {
    expect(seed().safety).toEqual(getProposedConfig("activity.safety_rules").value);
  });

  it("the goal defaults match the registry entry", () => {
    expect(seed().goals).toEqual(getProposedConfig("activity.goals").value);
  });

  it("both entries are PROPOSED and owned by the CMO (an agent never confirms them)", () => {
    for (const key of ["activity.safety_rules", "activity.goals"]) {
      const e = getProposedConfig(key);
      expect(e.status).toBe("proposed");
      expect(e.owner).toBe("CMO");
    }
  });

  it("every rule's blocked kinds are real kinds, and every kind has an effort value above zero", () => {
    const v = getProposedConfig("activity.safety_rules").value as {
      kinds: Record<string, { effort_met: number; intensity: string }>;
      rules: Record<string, { blocked_kinds: string[]; max_intensity: string }>;
    };
    for (const rule of Object.values(v.rules)) for (const k of rule.blocked_kinds) expect(Object.keys(v.kinds)).toContain(k);
    for (const k of Object.values(v.kinds)) expect(k.effort_met).toBeGreaterThan(0);
  });

  it("the spec's seven activity kinds are all present, including farm and manual work and chair-based", () => {
    const v = getProposedConfig("activity.safety_rules").value as { kinds: Record<string, unknown> };
    for (const k of ["walking", "running", "cycling", "dancing", "football", "farm_manual_work", "chair_based"]) expect(Object.keys(v.kinds)).toContain(k);
  });
});
