import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allStrings, causalWordingHits } from "../causal-wording";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Rules = {
  condition: string;
  adjustment_window_days: number;
  signals: { medication_amendment: { enabled: boolean }; confirmed_plan_change: { enabled: boolean; actions: string[] } };
  groups: { code: string }[];
  shown_separately: { code: string }[];
  limitations: string;
  note: string;
};

describe("outcomes.adjustment_rules mirrors the migration seed (D3)", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_d3_bp_control_by_medicine_adjustment.sql"));
  if (!file) throw new Error("D3 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Rules>("outcomes.adjustment_rules");

  it("is identical to the outcome_adjustment_config v1 seed", () => {
    const match = /adjustment-rules-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("adjustment seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "outcomes.adjustment_rules");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the migration seeds it unsigned and inactive and nothing in the seed signs", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-28'/);
    const seedPart = sql.slice(sql.indexOf("adjustment-rules-v1-begin"), sql.indexOf("adjustment-rules-v1-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
  });

  it("defines adjusted as a window plus two named records, and keeps the people not on a medicine and the unknown-control people separate", () => {
    expect(cfg.value.condition).toBe("hypertension");
    expect(cfg.value.adjustment_window_days).toBeGreaterThan(0);
    expect(cfg.value.signals.confirmed_plan_change.actions).toEqual(["change", "start"]);
    expect(cfg.value.groups.map((g) => g.code)).toEqual(["adjusted", "not_adjusted"]);
    expect(cfg.value.shown_separately.map((g) => g.code)).toEqual(["not_on_recorded_medicine", "control_unknown"]);
    expect(cfg.value.limitations).toMatch(/not on a recorded medicine are shown separately/);
  });

  it("carries the fixed descriptive-not-causal note, and no text claims cause or names a clinician", () => {
    expect(cfg.value.note).toMatch(/descriptive, not causal/);
    expect(causalWordingHits(allStrings(cfg.value))).toEqual([]);
    expect(JSON.stringify(cfg.value)).not.toMatch(/—/);
  });
});
