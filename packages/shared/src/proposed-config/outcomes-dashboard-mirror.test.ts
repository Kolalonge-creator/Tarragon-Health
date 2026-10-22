import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(suffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]);
}

type Dashboard = {
  due_days: number[];
  primary_day: number;
  min_age_years: number;
  confidence_level: number;
  comparison: { min_per_group: number; high_active_days_per_30: number; low_active_days_per_30: number; exclude_blood_pressure_from_engagement: boolean };
  engagement: { points_rules_included: string[]; milestone_rules: string[]; screening_excluded_code_patterns: string[] };
};

describe("outcomes.dashboard mirrors the outcomes_dashboard_config v1 seed", () => {
  it("is identical to the migration seed", () => {
    expect(seed("_outcomes_dashboard.sql", "outcomes-dashboard-config")).toEqual(getProposedConfig("outcomes.dashboard").value);
  });

  it("is owned by the CMO and proposed, never self-confirmed", () => {
    const e = getProposedConfig("outcomes.dashboard");
    expect(e.owner).toBe("CMO");
    expect(e.status).toBe("proposed");
  });

  it("keeps the comparison honest: high is above low, blood pressure is not engagement, a group needs a real sample, an adult age", () => {
    const v = getProposedConfig("outcomes.dashboard").value as Dashboard;
    expect(v.comparison.high_active_days_per_30).toBeGreaterThan(v.comparison.low_active_days_per_30);
    expect(v.comparison.exclude_blood_pressure_from_engagement).toBe(true);
    expect(v.comparison.min_per_group).toBeGreaterThanOrEqual(30);
    expect(v.min_age_years).toBeGreaterThanOrEqual(18);
    expect(v.due_days).toContain(v.primary_day);
    expect([0.9, 0.95, 0.99]).toContain(v.confidence_level);
  });

  it("counts points only from rules that cannot touch protected data, and never from screening, lab or review awards", () => {
    const v = getProposedConfig("outcomes.dashboard").value as Dashboard;
    for (const rule of ["screening_done", "lab_done", "review_attended"]) expect(v.engagement.points_rules_included).not.toContain(rule);
    for (const m of v.engagement.milestone_rules) expect(v.engagement.points_rules_included).toContain(m);
  });

  it("excludes the protected screening kinds by pattern (reproductive, sexual health, HIV and hepatitis, mental health)", () => {
    const v = getProposedConfig("outcomes.dashboard").value as Dashboard;
    const patterns = v.engagement.screening_excluded_code_patterns.map((p) => new RegExp(p, "i"));
    for (const code of ["cervical_smear", "mammography", "hiv", "hep_b", "antenatal_panel", "phq9", "gad7", "psa", "pap_smear", "contraception_review"]) {
      expect([code, patterns.some((re) => re.test(code))]).toEqual([code, true]);
    }
    for (const code of ["hba1c", "blood_pressure", "lipid_panel", "ferritin"]) {
      expect([code, patterns.some((re) => re.test(code))]).toEqual([code, false]);
    }
  });
});
