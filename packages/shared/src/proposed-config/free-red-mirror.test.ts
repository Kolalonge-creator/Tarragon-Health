import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_two_tier_free_red_event_path.sql"));
  if (!file) throw new Error("two-tier free red path migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /free-red-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("free red rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("free_red_event.rules mirrors the migration seed", () => {
  it("is identical, so the registry and free_red_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("free_red_event.rules").value);
  });

  it("checks in after it asks the patient to recheck", () => {
    const v = getProposedConfig("free_red_event.rules").value as { recheck_minutes: number; checkin_minutes: number };
    expect(v.checkin_minutes).toBeGreaterThan(v.recheck_minutes);
  });
});
