import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The rules the S69b migration seeds between its begin/end markers. */
function seededRules(): Record<string, unknown> {
  const files = readdirSync(MIGRATIONS).filter((f) => /_s69b_care_circle_.*\.sql$/.test(f)).sort();
  let latest: string | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const match = /care-circle-tools-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (match?.[1]) latest = match[1];
  }
  if (!latest) throw new Error("care circle tools rules seed not found in any S69b migration");
  return JSON.parse(latest) as Record<string, unknown>;
}

describe("care_circle.supporter_tools mirrors the migration seed", () => {
  it("is identical, so the registry and care_circle_tools_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("care_circle.supporter_tools").value);
  });

  it("is proposed, owned by the founder, and carries every key the database validates", () => {
    const e = getProposedConfig("care_circle.supporter_tools");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    expect(Object.keys(e.value as object).sort()).toEqual(["digest_days", "missed_dose_grace_minutes", "missed_dose_max_per_day", "missed_dose_window_minutes", "task_keep_days", "task_max_open"]);
  });

  it("the grace period is the 30-minute wait the reference product uses and the window after it is about an hour", () => {
    const v = getProposedConfig("care_circle.supporter_tools").value as { missed_dose_grace_minutes: number; missed_dose_window_minutes: number };
    expect(v.missed_dose_grace_minutes).toBe(30);
    expect(v.missed_dose_window_minutes).toBe(60);
  });
});
