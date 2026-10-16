import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s46_results_serology_health_report.sql"));
  if (!file) throw new Error("S46 migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function s47Migration(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s47_report_settings_v2_comorbidity_min_readings.sql"));
  if (!file) throw new Error("S47 report settings migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("S46 proposed config mirrors the migration seeds", () => {
  it("report.settings is identical to health_report_config_versions v2 (S47) and stays proposed", () => {
    const m = /health-report-config-v2-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(s47Migration());
    if (!m?.[1]) throw new Error("report settings v2 seed not found");
    expect(JSON.parse(m[1])).toEqual(getProposedConfig("report.settings").value);
    expect(getProposedConfig("report.settings").status).toBe("proposed");
    expect(getProposedConfig("report.settings").version).toBe(2);
  });

  it("report.settings v2 has no borderline margin, a 12-reading 3-day minimum, a comorbidity-aware target and says which numbers are product rules", () => {
    const v = getProposedConfig("report.settings").value as Record<string, unknown>;
    expect(v).not.toHaveProperty("bpBorderlineMarginMmHg");
    expect(v).not.toHaveProperty("labBorderlineMarginPct");
    expect(v.minBpReadings).toBe(12);
    expect(v.minBpDays).toBe(3);
    expect(v.bpTarget).toEqual({ systolicBelow: 140, diastolicBelow: 90 });
    expect(v.bpTargetHigherRisk).toEqual({ systolicBelow: 130, diastolicBelow: 80 });
    expect(v.bpHighNormalBand).toEqual({ systolicFrom: 130, systolicBelow: 140, diastolicFrom: 80, diastolicBelow: 90 });
    expect(v.productRules).toEqual(["maxPriorities", "changeTolerancePct", "recheckWeeks", "priorityWindows", "trendMinPoints", "trendYears"]);
    expect(v.statementApprovedByCmo).toBe(false);
  });

  it("the S46 serology rule (version 2 in the database, now legacy) still says annual for HIV and hepatitis C; the registry key moved on to S47's version (see s47-mirror.test.ts)", () => {
    const m = /serology-rules-begin\s*\$json\$([\s\S]*?)\$json\$/.exec(migration());
    if (!m?.[1]) throw new Error("serology rules seed not found");
    const seed = JSON.parse(m[1]) as { antiHbs: { thresholdStatus: string }; hiv: { repeatMonths: number }; hep_c: { repeatMonths: number }; hep_b: { stopsWhenHbvStatus: string[] } };
    expect(seed.antiHbs.thresholdStatus).toBe("proposed_unsigned");
    expect(seed.hiv.repeatMonths).toBe(12);
    expect(seed.hep_c.repeatMonths).toBe(12);
    expect(seed.hep_b.stopsWhenHbvStatus).toEqual(["immune"]);
  });
});
