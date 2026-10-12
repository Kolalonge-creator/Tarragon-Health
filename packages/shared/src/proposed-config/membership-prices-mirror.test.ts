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

  it("the individual price row is the registry's individual price", () => {
    const m = /insert into public\.prices[^;]*?values \(it\.organisation_id, it\.id, (\d+), v_now,/.exec(sql);
    if (!m?.[1]) throw new Error("individual price insert not found");
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

  it("the individual price takes effect when the migration is applied and closes the 100,000 row at the same instant (never parked)", () => {
    expect(sql).not.toMatch(/2099|park/i);
    expect(sql).toMatch(/update public\.prices set valid_to = v_now where id = v_old\.id;/);
    expect(sql).toMatch(/values \(it\.organisation_id, it\.id, 12000000, v_now,/);
  });
});

describe("the Membership lapse config mirrors the migration", () => {
  const lapse = getProposedConfig("membership.lapse").value as { grace_days: number; reminder_days_before: number[] };
  it("is identical to the membership_lapse_config seed", () => {
    const sql = migration("_two_tier_only_free_and_member.sql");
    const match = /membership-lapse-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("membership lapse seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(lapse);
  });
  it("is 14 days of grace and reminders at 30, 14 and 7 days, longest first", () => {
    expect(lapse.grace_days).toBe(14);
    expect(lapse.reminder_days_before).toEqual([30, 14, 7]);
  });
});
