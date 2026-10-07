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

describe("S46 proposed config mirrors the migration seeds", () => {
  it("report.settings is identical to health_report_config_versions v1 and stays proposed", () => {
    const m = /health-report-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration());
    if (!m?.[1]) throw new Error("report settings seed not found");
    expect(JSON.parse(m[1])).toEqual(getProposedConfig("report.settings").value);
    expect(getProposedConfig("report.settings").status).toBe("proposed");
  });

  it("screening.serology_rules is identical to serology_rule_versions v2 and keeps the anti-HBs threshold unconfirmed", () => {
    const m = /serology-rules-begin\s*\$json\$([\s\S]*?)\$json\$/.exec(migration());
    if (!m?.[1]) throw new Error("serology rules seed not found");
    const seed = JSON.parse(m[1]) as { antiHbs: { thresholdStatus: string }; hiv: { repeatMonths: number }; hep_c: { repeatMonths: number }; hep_b: { stopsWhenHbvStatus: string[] } };
    expect(seed).toEqual(getProposedConfig("screening.serology_rules").value);
    expect(seed.antiHbs.thresholdStatus).toBe("proposed_unsigned");
    // the spec rule: HIV and hepatitis C annual, HBsAg stops only on recorded immunity
    expect(seed.hiv.repeatMonths).toBe(12);
    expect(seed.hep_c.repeatMonths).toBe(12);
    expect(seed.hep_b.stopsWhenHbvStatus).toEqual(["immune"]);
  });
});
