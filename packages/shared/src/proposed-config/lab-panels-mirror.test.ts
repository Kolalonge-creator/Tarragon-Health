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

type Range = { refLow?: number; refHigh?: number };
type Analyte = { code: string; kind: string; unit: string; sensitive?: boolean; optional?: boolean; refLow?: number; refHigh?: number; criticalLow?: number; criticalHigh?: number; bySex?: { male?: Range; female?: Range } };
const panels = () => (getProposedConfig("lab.panels").value as { panels: Record<string, { analytes: Analyte[] }> }).panels;

describe("lab.panels mirrors the migration seed", () => {
  it("is identical to the membership_annual lab_panel_versions seed (S27g)", () => {
    const match = /lab-panels-v2-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration("_s27g_lab_panel_membership_sex_ranges.sql"));
    if (!match?.[1]) throw new Error("lab panel v2 seed not found in the migration");
    expect(JSON.parse(match[1]).panels.membership_annual.analytes).toEqual(panels().membership_annual!.analytes);
    expect(getProposedConfig("lab.panels").version).toBe(2);
  });

  it("there is exactly one panel and the package-era names are gone", () => {
    expect(Object.keys(panels())).toEqual(["membership_annual"]);
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

  it("sex-specific ranges exist only for haemoglobin, creatinine and HDL, sit inside sensible bounds, and never differ in critical limits", () => {
    const withSex = panels().membership_annual!.analytes.filter((x) => x.bySex);
    expect(withSex.map((x) => x.code).sort()).toEqual(["creatinine", "haemoglobin", "hdl_cholesterol"]);
    const hb = withSex.find((x) => x.code === "haemoglobin")!;
    // WHO 2024 anaemia thresholds: 13 g/dL for men, 12 g/dL for non-pregnant women.
    expect(hb.bySex!.male!.refLow).toBe(13);
    expect(hb.bySex!.female!.refLow).toBe(12);
    for (const a of withSex) {
      for (const r of [a.bySex!.male, a.bySex!.female]) {
        if (r?.refLow !== undefined && a.criticalLow !== undefined) expect(a.criticalLow).toBeLessThan(r.refLow);
        if (r?.refHigh !== undefined && a.criticalHigh !== undefined) expect(a.criticalHigh).toBeGreaterThan(r.refHigh);
      }
    }
  });

  it("every required (non-optional) analyte is numeric, so an all-normal panel can release, and the three screening items are optional", () => {
    const list = panels().membership_annual!.analytes;
    expect(list.filter((x) => !x.optional).every((x) => x.kind === "numeric")).toBe(true);
    expect(list.filter((x) => x.optional).map((x) => x.code).sort()).toEqual(["hbsag", "hcv_ab", "hiv_screen"]);
  });

  it("the units are the ones Nigerian laboratories most often print", () => {
    const unit = (c: string) => panels().membership_annual!.analytes.find((x) => x.code === c)?.unit;
    expect(unit("fasting_glucose")).toBe("mg/dL");
    expect(unit("creatinine")).toBe("mg/dL");
    expect(unit("total_cholesterol")).toBe("mg/dL");
    expect(unit("sodium")).toBe("mmol/L");
    expect(unit("potassium")).toBe("mmol/L");
    expect(unit("haemoglobin")).toBe("g/dL");
    expect(unit("hba1c")).toBe("%");
  });

  it("the task type seeded by S27 is a class 2 task with no lead window", () => {
    const sql = migration("_s27_lab_results_release_rules.sql");
    const block = /task-types-s27-begin([\s\S]*?)task-types-s27-end/.exec(sql)?.[1] ?? "";
    expect(block).toContain("'sensitive_result_disclosure', 1, 2, 120, 'senior_medical_officer'");
    expect(block).toContain("'{result_review}', 0, 30, false, true");
  });

  it("lab.release_policy is identical to the lab_panel_signoffs seed, and a sensitive result is never released by default", () => {
    const sql = migration("_s27d_signoff_corrections_disclosure_fallback_staff_path.sql");
    const match = /lab-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("lab release policy seed not found in the migration");
    const seeded = JSON.parse(match[1]);
    expect(seeded).toEqual(getProposedConfig("lab.release_policy").value);
    expect(seeded.disclosure.maxAttempts).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(seeded)).not.toMatch(/auto.?release/i);
  });
});
