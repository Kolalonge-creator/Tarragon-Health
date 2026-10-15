import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s03b_account_recovery_routes.sql"));
  if (!file) throw new Error("S03b account recovery migration not found");
  const match = /account-recovery-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("account recovery rules seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("auth.recovery_rules mirrors the migration seed", () => {
  it("is identical, so the registry and account_recovery_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("auth.recovery_rules").value);
  });

  it("is proposed and owned by the founder", () => {
    const e = getProposedConfig("auth.recovery_rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
  });

  it("gives ten backup codes, as the founder decided, and every value is a positive whole number", () => {
    const v = getProposedConfig("auth.recovery_rules").value as Record<string, number>;
    expect(v.backup_code_count).toBe(10);
    for (const [k, n] of Object.entries(v)) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
      void k;
    }
  });

  it("keeps the recovery contact wait at least a day and the number-change hold at least a day", () => {
    const v = getProposedConfig("auth.recovery_rules").value as Record<string, number>;
    expect(v.contact_delay_hours).toBeGreaterThanOrEqual(24);
    expect(v.number_change_hold_hours).toBeGreaterThanOrEqual(24);
  });
});
