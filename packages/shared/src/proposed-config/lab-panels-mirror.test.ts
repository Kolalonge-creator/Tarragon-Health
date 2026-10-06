import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

type Analyte = { code: string; kind: string; unit: string; sensitive?: boolean; optional?: boolean; refLow?: number; refHigh?: number; criticalLow?: number; criticalHigh?: number };
const panels = () => (getProposedConfig("lab.panels").value as { panels: Record<string, { analytes: Analyte[] }> }).panels;

describe("lab.panels mirrors the migration seed", () => {
  it("is identical to the lab_panel_versions seed", () => {
    const match = /lab-panels-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration("_s27_lab_results_release_rules.sql"));
    if (!match?.[1]) throw new Error("lab panel seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("lab.panels").value);
  });

  it("only the three screening analytes are sensitive, and each is qualitative and optional", () => {
    const sensitive = Object.values(panels()).flatMap((p) => p.analytes.filter((a) => a.sensitive));
    expect(new Set(sensitive.map((a) => a.code))).toEqual(new Set(["hiv_screen", "hbsag", "hcv_ab"]));
    for (const a of sensitive) {
      expect(a.kind).toBe("qualitative");
      expect(a.optional).toBe(true);
    }
  });

  it("every numeric analyte has a unit and no critical limit sits inside its reference range", () => {
    for (const p of Object.values(panels())) {
      for (const a of p.analytes.filter((x) => x.kind === "numeric")) {
        expect(a.unit).not.toBe("");
        if (a.criticalLow !== undefined && a.refLow !== undefined) expect(a.criticalLow).toBeLessThan(a.refLow);
        if (a.criticalHigh !== undefined && a.refHigh !== undefined) expect(a.criticalHigh).toBeGreaterThan(a.refHigh);
      }
    }
  });

  it("the annual panel contains the essential panel", () => {
    const e = panels().essential!.analytes.map((a) => a.code);
    const a = panels().annual_health_check!.analytes.map((x) => x.code);
    for (const code of e) expect(a).toContain(code);
  });

  it("the task type seeded by S27 is a class 2 task with no lead window", () => {
    const sql = migration("_s27_lab_results_release_rules.sql");
    const block = /task-types-s27-begin([\s\S]*?)task-types-s27-end/.exec(sql)?.[1] ?? "";
    expect(block).toContain("'sensitive_result_disclosure', 1, 2, 120, 'senior_medical_officer'");
    expect(block).toContain("'{result_review}', 0, 30, false, true");
  });
});
