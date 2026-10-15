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

describe("pharmacy.collection_rules mirrors the migration seed", () => {
  it("the registry value is identical to the active pharmacy_config seed (v2, S54c)", () => {
    expect(seed("_s54c_clinician_suggests_pharmacy_patient_confirms.sql", "pharmacy-rules-v2")).toEqual(getProposedConfig("pharmacy.collection_rules").value);
  });
  it("v2 keeps every S28 value unchanged and only adds the suggestion window", () => {
    const v1 = seed("_s28_pharmacy_collection_and_dispensing.sql", "pharmacy-rules") as Record<string, number>;
    const v2 = seed("_s54c_clinician_suggests_pharmacy_patient_confirms.sql", "pharmacy-rules-v2") as Record<string, number>;
    for (const [k, v] of Object.entries(v1)) expect(v2[k]).toBe(v);
    expect(v2.suggestion_valid_days).toBeGreaterThan(0);
  });
  it("the code is long enough to resist guessing and the lock comes before a guess can succeed", () => {
    const v = getProposedConfig("pharmacy.collection_rules").value as { code_length: number; code_valid_days: number; max_wrong_attempts: number };
    expect(v.code_length).toBeGreaterThanOrEqual(8);
    expect(v.max_wrong_attempts).toBeLessThanOrEqual(5);
    expect(v.code_valid_days).toBeGreaterThan(0);
  });
});
