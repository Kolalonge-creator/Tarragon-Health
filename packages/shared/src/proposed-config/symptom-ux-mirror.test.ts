import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seedOf(kind: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s59c_assessment_ux.sql"));
  if (!file) throw new Error("S59c migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const m = new RegExp(`-- ux-seed-${kind}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$[\\s\\S]*?-- ux-seed-${kind}-end`).exec(sql);
  if (!m?.[1]) throw new Error(`S59c seed for ${kind} not found`);
  return JSON.parse(m[1]);
}

describe("the S59c assessment experience configs mirror the migration seeds", () => {
  const keys = [
    ["symptom.checkback", "checkback"],
    ["symptom.describe_synonyms", "describe"],
    ["symptom.result_explainer", "explainer"],
    ["symptom.safety_net", "safety_net"],
  ] as const;
  for (const [key, kind] of keys) {
    it(`${key} equals symptom_ux_config ${kind} version 1`, () => {
      expect(seedOf(kind)).toEqual(getProposedConfig(key).value);
    });
    it(`${key} is a CMO-owned, proposed, unsigned draft`, () => {
      const entry = getProposedConfig(key);
      expect(entry.owner).toBe("CMO");
      expect(entry.status).toBe("proposed");
      const value = entry.value as { status: string; clinical_sign_off: unknown };
      expect(value.status).toBe("draft");
      expect(value.clinical_sign_off).toBeNull();
    });
  }

  it("no phone number is shipped in the safety net (the emergency number is unconfirmed)", () => {
    const v = getProposedConfig("symptom.safety_net").value as { emergency_number: { value: string; confirmed: boolean } | null; entries: { triggers: string[] }[] };
    expect(v.emergency_number?.confirmed).toBe(false);
    expect(v.entries.flatMap((e) => e.triggers).join(" ")).not.toMatch(/\d{3}/);
  });
});
