import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allStrings, causalWordingHits } from "../causal-wording";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Stage = { code: string; label: string; definition: string };
type Condition = { stages: Stage[]; not_available: { item: string; reason: string }[]; lookback_days: number };
type Cascade = {
  min_adult_age_years: number;
  exclude_pregnant: boolean;
  hypertension: Condition & { controlled_below: { systolic: number; diastolic: number }; min_readings: number; control_window_days: number };
  diabetes: Condition & { controlled_hba1c_below_percent: number };
  selection_panel: { note: string; eligible_roster_reason: string; age_bands: number[][] };
  notes: { cascade: string; difference_from_s38: string };
};

describe("outcomes.cascade_rules mirrors the migration seed (WP3)", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_wp3_cascade_of_care_and_selection_panel.sql"));
  if (!file) throw new Error("WP3 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Cascade>("outcomes.cascade_rules");

  it("is identical to the outcome_cascade_config v1 seed", () => {
    const match = /cascade-rules-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("cascade seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "outcomes.cascade_rules");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the migration seeds it unsigned and inactive and nothing in it signs", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-23'/);
    const seedPart = sql.slice(sql.indexOf("cascade-rules-v1-begin"), sql.indexOf("cascade-rules-v1-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
  });

  it("uses the 140/90 and 7.0 percent lines and the five stages in order", () => {
    expect(cfg.value.hypertension.controlled_below).toEqual({ systolic: 140, diastolic: 90 });
    expect(cfg.value.diabetes.controlled_hba1c_below_percent).toBe(7.0);
    for (const c of [cfg.value.hypertension, cfg.value.diabetes]) {
      expect(c.stages.map((s) => s.code)).toEqual(["enrolled", "screened", "diagnosed", "on_treatment", "controlled"]);
    }
  });

  it("states what cannot be derived instead of inventing it", () => {
    for (const c of [cfg.value.hypertension, cfg.value.diabetes]) {
      expect(c.not_available.map((n) => n.item)).toEqual(expect.arrayContaining(["Population screening coverage", "Prevalence"]));
    }
    expect(cfg.value.selection_panel.eligible_roster_reason).toMatch(/cannot be counted/);
  });

  it("carries the fixed descriptive-not-causal note, and no text claims cause", () => {
    expect(cfg.value.selection_panel.note).toMatch(/descriptive, not causal/);
    expect(causalWordingHits(allStrings(cfg.value))).toEqual([]);
  });

  it("no em dash appears in any shown text", () => {
    expect(JSON.stringify(cfg.value)).not.toMatch(/—/);
  });
});
