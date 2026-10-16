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
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("risk.who_cvd_2019").value);
  });

  it("is proposed (never confirmed by an agent) and holds no coefficients", () => {
    const entry = getProposedConfig("risk.who_cvd_2019");
    expect(entry.status).toBe("proposed");
    const v = entry.value as { coefficientsVerified: boolean; models: Record<string, Record<string, unknown>> };
    expect(v.coefficientsVerified).toBe(false);
    expect(v.models.lab?.male).toBeNull();
  });
});
