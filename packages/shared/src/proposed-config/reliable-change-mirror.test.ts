import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allStrings, causalWordingHits } from "../causal-wording";
import { classifyReliableChange, reliableChangePoints } from "../reliable-change";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Rules = {
  instruments: Record<string, { reliable_change_points: number; scale_points: number }>;
  categories: { code: string }[];
  group: string;
  source: string;
  note: string;
};

describe("outcomes.reliable_change_rules mirrors the migration seed (D4)", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_d4_reliable_change_phq9_gad7.sql"));
  if (!file) throw new Error("D4 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Rules>("outcomes.reliable_change_rules");

  it("is identical to the outcome_reliable_change_config v1 seed", () => {
    const match = /reliable-change-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("reliable change seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "outcomes.reliable_change_rules");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the migration seeds it unsigned and inactive and nothing in the seed signs", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-28'/);
    const seedPart = sql.slice(sql.indexOf("reliable-change-v1-begin"), sql.indexOf("reliable-change-v1-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
  });

  it("names its source, says it is not validated for Nigeria, and is descriptive, not causal", () => {
    expect(cfg.value.source).toMatch(/Jacobson/);
    expect(cfg.value.source).toMatch(/NOT validated for Nigeria/);
    expect(cfg.value.note).toMatch(/descriptive, not causal/);
    expect(causalWordingHits(allStrings(cfg.value))).toEqual([]);
    expect(JSON.stringify(cfg.value)).not.toMatch(/—/);
  });

  it("covers exactly the PHQ-9 and the GAD-7 and the four categories, in order", () => {
    expect(Object.keys(cfg.value.instruments).sort()).toEqual(["gad7", "phq9"]);
    expect(cfg.value.categories.map((c) => c.code)).toEqual(["reliable_improvement", "no_reliable_change", "reliable_deterioration", "insufficient_data"]);
    expect(reliableChangePoints(cfg.value, "phq9")).toBe(cfg.value.instruments.phq9?.reliable_change_points);
  });

  it("the TypeScript rule and the SQL rule agree on the cases the migration's own self-check uses", () => {
    expect(sql).toMatch(/reliable_change_class\(12, 6, 6\) <> 'reliable_improvement'/);
    expect(sql).toMatch(/reliable_change_class\(12, 7, 6\) <> 'no_reliable_change'/);
    expect(sql).toMatch(/reliable_change_class\(8, 14, 6\) <> 'reliable_deterioration'/);
    expect(sql).toMatch(/reliable_change_class\(null, 3, 6\) <> 'insufficient_data'/);
    expect(classifyReliableChange(12, 6, 6)).toBe("reliable_improvement");
    expect(classifyReliableChange(12, 7, 6)).toBe("no_reliable_change");
    expect(classifyReliableChange(8, 14, 6)).toBe("reliable_deterioration");
    expect(classifyReliableChange(null, 3, 6)).toBe("insufficient_data");
  });

  it("the report never names a single answer or a safety flag", () => {
    const body = sql.slice(sql.indexOf("create function public.mental_health_reliable_change_report"));
    expect(body).not.toMatch(/item_responses|crisis_flagged|item 9|crisis/i);
  });
});
