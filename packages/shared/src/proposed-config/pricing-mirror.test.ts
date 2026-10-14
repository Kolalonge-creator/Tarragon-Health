import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s73_pricing_engine.sql"));
  if (!file) throw new Error("S73 migration not found");
  const match = /pricing-rules-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("pricing rules seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("pricing.rules mirrors the migration seed", () => {
  it("is identical, so the registry and pricing_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("pricing.rules").value);
  });

  it("is proposed, owned by the founder, and points stay OFF until the founder signs the values", () => {
    const e = getProposedConfig("pricing.rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    const v = e.value as { points: { enabled: boolean; max_percent_of_service_fee: number }; min_payable_kobo: number };
    expect(v.points.enabled).toBe(false);
    expect(v.points.max_percent_of_service_fee).toBeLessThanOrEqual(100);
    expect(Number.isInteger(v.min_payable_kobo)).toBe(true);
  });

  it("names a third-party floor, so no discount can go below what a clinician or partner is owed", () => {
    const v = getProposedConfig("pricing.rules").value as { third_party_component_keys: string[] };
    expect(v.third_party_component_keys.length).toBeGreaterThan(0);
  });
});
