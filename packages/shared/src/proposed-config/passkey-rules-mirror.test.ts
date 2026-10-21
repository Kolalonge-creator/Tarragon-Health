import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("auth.passkey_rules", () => {
  const v = getProposedConfig("auth.passkey_rules").value as Record<string, number>;

  it("is proposed and owned by the founder", () => {
    const e = getProposedConfig("auth.passkey_rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
  });

  it("holds positive whole numbers only", () => {
    for (const n of Object.values(v)) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });

  it("keeps the add authorisation inside the range the database clamps to (1..15 minutes), read from the migration itself", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_optional_passkeys.sql"));
    if (!file) throw new Error("optional passkeys migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const m = /greatest\((\d+), least\((\d+), coalesce\(p_minutes, (\d+)\)\)\)/.exec(sql);
    if (!m) throw new Error("clamp expression not found in the migration");
    const [lo, hi, dflt] = [Number(m[1]), Number(m[2]), Number(m[3])];
    expect(v.add_authorisation_minutes).toBeGreaterThanOrEqual(lo);
    expect(v.add_authorisation_minutes).toBeLessThanOrEqual(hi);
    expect(dflt).toBe(v.add_authorisation_minutes);
  });

  it("ships the switch OFF in the migration", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_optional_passkeys.sql"));
    const sql = readFileSync(join(MIGRATIONS, file as string), "utf8");
    expect(/values \('passkeys',[\s\S]*?,\s*false,\s*true\)/.test(sql)).toBe(true);
  });
});
