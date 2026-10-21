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

describe("the Membership ladder prices mirror the migration", () => {
  const ladder = getProposedConfig("commerce.membership_ladder").value as {
    evergreen_code: string;
    evergreen_kobo: number;
    evergreen_plus_code: string;
    evergreen_plus_kobo: number;
    upgrade_kobo: number;
  };
  const sql = migration("_membership_evergreen_ladder_foundation.sql");

  it("states the founder's numbers in integer kobo: 84,000 and 129,000 naira, upgrade 45,000", () => {
    expect(ladder.evergreen_kobo).toBe(8_400_000);
    expect(ladder.evergreen_plus_kobo).toBe(12_900_000);
    expect(ladder.upgrade_kobo).toBe(4_500_000);
    expect(ladder.evergreen_plus_kobo - ladder.evergreen_kobo).toBe(ladder.upgrade_kobo);
    for (const n of [ladder.evergreen_kobo, ladder.evergreen_plus_kobo, ladder.upgrade_kobo]) expect(Number.isInteger(n)).toBe(true);
  });

  it("the migration inserts exactly these prices for exactly these codes", () => {
    expect(sql).toContain(`'${ladder.evergreen_code}'`);
    expect(sql).toContain(`'${ladder.evergreen_plus_code}'`);
    expect(sql).toMatch(new RegExp(`values \\(v_plus\\.organisation_id, v_plus\\.id, ${ladder.evergreen_plus_kobo}, v_now,`));
    expect(sql).toMatch(new RegExp(`values \\(v_eg\\.organisation_id, v_eg\\.id, ${ladder.evergreen_kobo}, v_now,`));
  });

  it("closes the old price row instead of editing it, and never parks a price in the future", () => {
    expect(sql).toMatch(/update public\.prices set valid_to = v_now where id = v_old\.id;/);
    expect(sql).not.toMatch(/2099|park/i);
  });

  it("leaves the Membership item inactive and does not teach patient_is_member about tiers", () => {
    expect(sql).toMatch(/c\.grants_lead, false,/);
    expect(sql).toMatch(/patient_is_member must not read the tier/);
  });

  it("an unknown code can never hand out the panel (falls to evergreen)", () => {
    expect(sql).toMatch(/case when p_code = 'membership_annual' then 'plus' else 'evergreen' end/);
  });

  it("names no banned tier word in the registry entry", () => {
    expect(JSON.stringify(ladder).toLowerCase()).not.toMatch(/basic|lite|standard|premium|gold/);
  });
});
