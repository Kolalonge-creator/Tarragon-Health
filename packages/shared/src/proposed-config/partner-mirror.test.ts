import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(suffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]);
}

describe("partner.quality mirrors the migration seed", () => {
  it("the registry value is identical to the active partner_quality_config seed (v2, S28e)", () => {
    expect(seed("_s28e_pharmacy_visits_stock_scorecard.sql", "partner-quality-v2")).toEqual(getProposedConfig("partner.quality").value);
  });
  it("v2 keeps every S74 value unchanged and only adds the pharmacy figures and the suggest-only kinds", () => {
    const v1 = seed("_s74_partner_quality_and_removal.sql", "partner-quality") as Record<string, unknown> & { removal: Record<string, unknown> };
    const v2 = seed("_s28e_pharmacy_visits_stock_scorecard.sql", "partner-quality-v2") as Record<string, unknown> & { removal: Record<string, unknown> };
    for (const [k, v] of Object.entries(v1)) {
      if (k === "removal") continue;
      expect(v2[k]).toEqual(v);
    }
    for (const [k, v] of Object.entries(v1.removal)) expect(v2.removal[k]).toEqual(v);
    expect(v2.pharmacy).toBeDefined();
    expect(v2.removal.suggest_only_kinds).toEqual(["pharmacy"]);
  });
  it("a pharmacy is only ever flagged for staff, never removed by the rule (spec 21.7), while a laboratory is not changed", () => {
    const v = getProposedConfig("partner.quality").value as { removal: { suggest_only_kinds: string[] } };
    expect(v.removal.suggest_only_kinds).toContain("pharmacy");
    expect(v.removal.suggest_only_kinds).not.toContain("lab");
  });
  it("the weights add up to 100 and the suspend floor is below the warning floor", () => {
    const v = getProposedConfig("partner.quality").value as { weights: Record<string, number>; score: { warn_below: number; suspend_below: number } };
    expect(Object.values(v.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(v.score.suspend_below).toBeLessThan(v.score.warn_below);
  });
  it("an expired licence always takes a partner out of new work", () => {
    const v = getProposedConfig("partner.quality").value as { removal: { suspend_on: string[] } };
    expect(v.removal.suspend_on).toContain("licence_expired");
  });
});

describe("partner.settlement mirrors the migration seed", () => {
  it("v1 is identical to the partner_settlement_config v1 seed", () => {
    expect(seed("_s74_partner_settlement.sql", "partner-settlement")).toEqual(getProposedConfig("partner.settlement").value);
  });
  it("a laboratory is never a settlement partner (D-06)", () => {
    const v = getProposedConfig("partner.settlement").value as { partner_kinds: string[] };
    expect(v.partner_kinds).not.toContain("lab");
  });
  it("basis points cannot exceed the whole amount", () => {
    const v = getProposedConfig("partner.settlement").value as { basis_points_max: number };
    expect(v.basis_points_max).toBeLessThanOrEqual(10000);
  });
});

describe("pharmacy.chat mirrors the migration seed", () => {
  it("v1 is identical to the pharmacy_chat_config v1 seed", () => {
    expect(seed("_s74_pharmacy_sourcing_chat_and_clinic_slots.sql", "pharmacy-chat")).toEqual(getProposedConfig("pharmacy.chat").value);
  });
});
