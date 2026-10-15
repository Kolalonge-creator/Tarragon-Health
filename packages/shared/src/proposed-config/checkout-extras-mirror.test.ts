import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seeded(): { access_fund: Record<string, unknown>; payment_requests: Record<string, unknown> } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s72_checkout_extras.sql"));
  if (!file) throw new Error("S72 migration not found");
  const match = /checkout-extras-rules-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("checkout extras rules seed not found");
  return JSON.parse(match[1]) as { access_fund: Record<string, unknown>; payment_requests: Record<string, unknown> };
}

describe("access_fund.rules and payment_requests.rules mirror the migration seed", () => {
  it("access_fund.rules is identical, so the registry and the table cannot drift", () => {
    expect(seeded().access_fund).toEqual(getProposedConfig("access_fund.rules").value);
  });
  it("payment_requests.rules is identical", () => {
    expect(seeded().payment_requests).toEqual(getProposedConfig("payment_requests.rules").value);
  });
  it("both are proposed, not confirmed, and the Fund is owned jointly with counsel", () => {
    const a = getProposedConfig("access_fund.rules");
    const p = getProposedConfig("payment_requests.rules");
    expect(a.status).toBe("proposed");
    expect(p.status).toBe("proposed");
    expect(a.owner).toBe("Founder and counsel");
  });
  it("every published criterion is a lower-case key and there is at least one", () => {
    const v = getProposedConfig("access_fund.rules").value as { criteria: string[] };
    expect(v.criteria.length).toBeGreaterThan(0);
    for (const c of v.criteria) expect(c).toMatch(/^[a-z][a-z0-9_]+$/);
  });
  it("money values are whole kobo", () => {
    const v = getProposedConfig("access_fund.rules").value as { min_donation_kobo: number; max_grant_kobo: number };
    expect(Number.isInteger(v.min_donation_kobo)).toBe(true);
    expect(Number.isInteger(v.max_grant_kobo)).toBe(true);
    expect(v.max_grant_kobo).toBeGreaterThan(v.min_donation_kobo);
  });
});
