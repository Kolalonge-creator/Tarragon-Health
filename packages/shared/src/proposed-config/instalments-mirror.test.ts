import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const DIR = join(ROOT, "supabase", "migrations");
function migration(suffix: string): string {
  const f = readdirSync(DIR).find((n) => n.endsWith(suffix));
  if (!f) throw new Error(`migration ${suffix} not found`);
  return readFileSync(join(DIR, f), "utf8");
}
const SUFFIX = "_s25b_membership_instalments.sql";

describe("the S25b pay-in-parts schedule mirrors the migration", () => {
  it("instalments.membership_schedule is the seed: 3 parts at 0, 30 and 60 days, 5 days of grace, reminders 3 days before and on the day", () => {
    const m = /instalments-schedule-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration(SUFFIX));
    if (!m?.[1]) throw new Error("schedule seed not found in the migration");
    const v = getProposedConfig("instalments.membership_schedule").value as {
      parts: number; due_offsets_days: number[]; grace_days: number; reminder_days_before: number[];
    };
    expect(JSON.parse(m[1])).toEqual(v);
    expect(v.parts).toBe(3);
    expect(v.due_offsets_days).toEqual([0, 30, 60]);
    expect(v.grace_days).toBe(5);
    expect(v.reminder_days_before).toEqual([3, 0]);
  });

  it("the shipped default in private.instalment_policy equals the seed, so a missing row never changes a rule", () => {
    const sql = migration(SUFFIX);
    const seed = getProposedConfig("instalments.membership_schedule").value;
    const d = /else '(\{[^']*\})'::jsonb|coalesce\(\(select rules from public\.instalment_policy_config where is_active\),\s*'(\{[^']*\})'::jsonb\)/.exec(sql);
    const text = d?.[1] ?? d?.[2];
    if (!text) throw new Error("default not found");
    expect(JSON.parse(text)).toEqual(seed);
  });

  it("the schedule is internally consistent: one offset per part, the first part due at once, offsets rising, every part inside a year", () => {
    const v = getProposedConfig("instalments.membership_schedule").value as { parts: number; due_offsets_days: number[]; grace_days: number };
    expect(v.due_offsets_days).toHaveLength(v.parts);
    expect(v.due_offsets_days[0]).toBe(0);
    expect([...v.due_offsets_days].sort((a, b) => a - b)).toEqual(v.due_offsets_days);
    expect(v.due_offsets_days[v.parts - 1]! + v.grace_days).toBeLessThan(365);
  });

  it("the module defaults OFF in the migration and the migration never switches it on", () => {
    const sql = migration(SUFFIX);
    expect(sql).toMatch(/insert into public\.platform_modules \(key, label, description\)\s*values \('membership_instalments'/);
    expect(sql).not.toMatch(/update public\.platform_modules[^;]*membership_instalments/);
  });
});
