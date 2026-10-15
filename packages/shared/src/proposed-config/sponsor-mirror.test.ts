import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s71_checkout_core.sql"));
  if (!file) throw new Error("S71 migration not found");
  const match = /sponsor-rules-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("sponsor rules seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("sponsor.rules mirrors the migration seed", () => {
  it("is identical, so the registry and sponsor_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("sponsor.rules").value);
  });
  it("is proposed and owned by the founder", () => {
    const e = getProposedConfig("sponsor.rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    const v = e.value as { hmo_checks_per_day: number; member_number_min_length: number; member_number_max_length: number };
    expect(v.member_number_min_length).toBeLessThan(v.member_number_max_length);
    expect(Number.isInteger(v.hmo_checks_per_day)).toBe(true);
  });
});

describe("commerce.processing_fee_estimate v3 carries the international card estimate", () => {
  it("keeps the local figures and adds the international ones", () => {
    const v = getProposedConfig("commerce.processing_fee_estimate").value as Record<string, number>;
    expect(v["localBasisPoints"]).toBe(150);
    expect(v["internationalBasisPoints"]).toBeGreaterThan(v["localBasisPoints"]!);
    expect(Number.isInteger(v["internationalFlatKobo"])).toBe(true);
  });
});
