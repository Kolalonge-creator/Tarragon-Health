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

describe("security.rules mirrors the migration seed", () => {
  it("v1 is identical to the security_config v1 seed", () => {
    expect(seed("_s39_security_hardening_round1.sql", "security-rules")).toEqual(getProposedConfig("security.rules").value);
  });
  it("the alert threshold is a positive whole number", () => {
    const v = getProposedConfig("security.rules").value as { lookup_failure_alert_per_hour: number };
    expect(Number.isInteger(v.lookup_failure_alert_per_hour)).toBe(true);
    expect(v.lookup_failure_alert_per_hour).toBeGreaterThan(0);
  });
});
