import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("the two-tier Membership prices mirror the migrations", () => {
  const prices = getProposedConfig("commerce.membership_prices").value as { individual_kobo: number; organisation_member_kobo: number };
  const limits = getProposedConfig("commerce.organisation_member_price_limits").value as {
    item_code: string;
    min_kobo: number;
    max_kobo: number;
    default_kobo: number;
  };
  const sql = migration("_two_tier_membership_pricing.sql");

  it("states the founder's numbers in integer kobo: 120,000 naira individual, 100,000 naira per organisation member", () => {
    expect(prices).toEqual({ individual_kobo: 12_000_000, organisation_member_kobo: 10_000_000 });
  });

  it("the organisation price limits seed is identical to the registry", () => {
    const match = /organisation-price-limits-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("organisation price limits seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(limits);
  });

  it("the parked individual price row is the registry's individual price", () => {
    const m = /insert into public\.prices[^;]*?values \(it\.organisation_id, it\.id, (\d+), v_park/.exec(sql);
    if (!m?.[1]) throw new Error("parked price insert not found");
    expect(Number(m[1])).toBe(prices.individual_kobo);
  });

  it("the default organisation price row is the registry's organisation price", () => {
    const m = /select i\.organisation_id, null, i\.id, (\d+), now\(\)/.exec(sql);
    if (!m?.[1]) throw new Error("default organisation price insert not found");
    expect(Number(m[1])).toBe(prices.organisation_member_kobo);
    expect(limits.default_kobo).toBe(prices.organisation_member_kobo);
  });

  it("both prices sit inside the floor and ceiling, and the floor stops a one naira typo", () => {
    for (const p of [prices.individual_kobo, prices.organisation_member_kobo]) {
      expect(p).toBeGreaterThanOrEqual(limits.min_kobo);
      expect(p).toBeLessThanOrEqual(limits.max_kobo);
    }
    expect(100).toBeLessThan(limits.min_kobo);
    expect(Number.isInteger(limits.min_kobo) && Number.isInteger(limits.max_kobo)).toBe(true);
  });

  it("has no volume tier anywhere in the pricing config", () => {
    const text = JSON.stringify([prices, limits]).toLowerCase();
    expect(text).not.toMatch(/tier|volume|bracket/);
  });

  it("parks the individual price far in the future so nothing changes live until the founder says go", () => {
    expect(sql).toMatch(/v_park constant timestamptz := timestamptz '2099-01-01/);
  });
});
