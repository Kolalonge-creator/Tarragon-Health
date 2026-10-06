import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("care_change.behaviour mirrors the migration seed", () => {
  it("is identical to the care_change_config seed", () => {
    const match = /care-change-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration("_s24_care_plan_changes_signed_prescribing.sql"));
    if (!match?.[1]) throw new Error("care change seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("care_change.behaviour").value);
  });

  it("a signed change waits 7 days for the patient", () => {
    const v = getProposedConfig("care_change.behaviour").value as { confirmWindowDays: number };
    expect(v.confirmWindowDays).toBe(7);
  });
});
