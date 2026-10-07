import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATION = join(
  fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations", "20261007123735_s69_community_cohorts_and_challenges.sql",
);
const sql = readFileSync(MIGRATION, "utf8");

function seededRules(): Record<string, unknown> {
  const match = /community-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("community rules seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function seededTemplates(): Array<Record<string, unknown>> {
  const block = /community-templates-begin\n([\s\S]*?)-- community-templates-end/.exec(sql)?.[1] ?? "";
  const rows = [...block.matchAll(/\('([a-z_]+)',\s*'([^']*)',\s*'([^']*)',\s*'([a-z_]+)',\s*'([a-z]+)',\s*(\d+),\s*(\d+)\)/g)];
  return rows.map((m) => ({
    code: m[1], label: m[2], description: m[3], metric: m[4], unit: m[5], default_days: Number(m[6]), target_per_member: Number(m[7]),
  }));
}

describe("community.rules mirrors the migration seed", () => {
  it("is identical, so the registry and community_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("community.rules").value);
  });

  it("is proposed, owned by the founder, and holds the binding floors", () => {
    const e = getProposedConfig("community.rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    const v = e.value as Record<string, number>;
    expect(v.min_contributors).toBeGreaterThanOrEqual(10); // founder 2026-10-07: never the institutional floor of 5
    expect(v.publish_delay_hours).toBeGreaterThanOrEqual(1);
    expect(v.board_min_cohorts).toBeGreaterThanOrEqual(3);
    expect(v.activity_minutes_week_cap).toBeLessThanOrEqual(300); // WHO 150 to 300 minutes a week
  });
});

describe("community.challenge_templates mirrors the migration seed", () => {
  it("is identical", () => {
    expect(seededTemplates()).toEqual(getProposedConfig("community.challenge_templates").value);
    expect(seededTemplates()).toHaveLength(7);
  });

  it("is proposed and owned by the CMO; nothing is marked approved", () => {
    const e = getProposedConfig("community.challenge_templates");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
    expect(/insert into public\.challenge_templates[^;]*'approved'/.test(sql)).toBe(false);
  });

  it("uses effort metrics only (no weight, calories, fasting, blood pressure or glucose)", () => {
    const allowed = ["log_days", "medicine_checkin_days", "lessons_completed", "activity_minutes", "low_salt_days", "consistent_sleep_days", "water_with_meals_days"];
    for (const t of seededTemplates()) {
      expect(allowed).toContain(t.metric);
      expect(`${String(t.label)} ${String(t.description)}`).not.toMatch(/weight|calorie|fasting|blood pressure|glucose|sugar|bp\b/i);
    }
  });
});
