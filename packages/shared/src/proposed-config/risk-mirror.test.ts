import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("risk.who_cvd_2019 mirrors the migration seed", () => {
  it("is identical to the risk_instrument_versions seed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s45_risk_screening_packages.sql"));
    if (!file) throw new Error("S45 migration not found");
    const match = /who-cvd-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("who_cvd seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("risk.who_cvd_2019", "2026-10-07").value);
  });

  it("version 1 is proposed (never confirmed by an agent) and holds no coefficients", () => {
    const entry = getProposedConfig("risk.who_cvd_2019", "2026-10-07");
    expect(entry.version).toBe(1);
    expect(entry.status).toBe("proposed");
    const v = entry.value as { coefficientsVerified: boolean; models: Record<string, Record<string, unknown>> };
    expect(v.coefficientsVerified).toBe(false);
    expect(v.models.lab?.male).toBeNull();
  });

  it("version 2 is identical to the v3 risk_instrument_versions seed with verified coefficients, and is still only proposed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_who_cvd_2019_wssa_v3_verified_coefficients.sql"));
    if (!file) throw new Error("v3 migration not found");
    const match = /who-cvd-v3-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("who_cvd v3 seed not found in the migration");
    const entry = getProposedConfig("risk.who_cvd_2019", "2026-11-03");
    expect(entry.version).toBe(2);
    expect(entry.status).toBe("proposed");
    expect(JSON.parse(match[1])).toEqual(entry.value);
    const v = entry.value as { coefficientsVerified: boolean; regionCheckedForNigeria: boolean; models: Record<string, Record<string, { shape?: string } | null>> };
    expect(v.coefficientsVerified).toBe(true);
    expect(v.regionCheckedForNigeria).toBe(true);
    expect(v.models.lab?.male?.shape).toBe("two_endpoint_recalibrated");
  });
});
