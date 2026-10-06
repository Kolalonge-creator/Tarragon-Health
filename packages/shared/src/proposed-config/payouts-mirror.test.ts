import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

describe("payouts.rules mirrors the migration seed", () => {
  it("is identical to the payouts_config seed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s31_weekly_payouts.sql"));
    if (!file) throw new Error("S31 migration not found");
    const match = /payouts-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("payouts rules seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("payouts.rules").value);
  });

  it("runs on a Monday morning in Lagos and carries small amounts over", () => {
    const v = getProposedConfig("payouts.rules").value as { cadence: { weekday: number; hour_lagos: number }; carry_over_below_minimum: boolean };
    expect(v.cadence.weekday).toBe(1);
    expect(v.cadence.hour_lagos).toBeLessThan(12);
    expect(v.carry_over_below_minimum).toBe(true);
  });
});
