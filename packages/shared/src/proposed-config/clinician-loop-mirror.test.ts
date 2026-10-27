import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s76_clinician_second_offer_silence_blast_radius.sql"));
  if (!file) throw new Error("clinician loop migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function seeded(): Record<string, unknown> {
  const match = /loop-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migrationSql());
  if (!match?.[1]) throw new Error("seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("clinician.loop_rules mirrors the migration seed", () => {
  it("is identical to clinician_loop_config version 1", () => {
    expect(seeded()).toEqual(getProposedConfig("clinician.loop_rules").value);
  });

  it("never re-offers red (class 1) and stays proposed", () => {
    const cfg = getProposedConfig("clinician.loop_rules");
    expect(Object.keys((cfg.value as { reoffer_after_minutes: Record<string, number> }).reoffer_after_minutes)).not.toContain("1");
    expect(cfg.status).toBe("proposed");
  });

  it("is born inactive and unsigned in the migration", () => {
    expect(migrationSql()).toMatch(/values \(1, false, '2026-10-27'/);
  });
});
