import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The JSON between a begin and end marker in the S56b migrations. */
function seeded(marker: string): unknown {
  const files = readdirSync(MIGRATIONS).filter((f) => /_s56b_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql);
    if (match?.[1]) return JSON.parse(match[1]);
  }
  throw new Error(`${marker} seed not found in any S56b migration`);
}

describe("S56b PROPOSED config mirrors the migration seeds", () => {
  it("mental_health.worklist_rules is identical to mental_health_worklist_config v1, proposed and owned by the CMO", () => {
    const e = getProposedConfig("mental_health.worklist_rules");
    expect(seeded("mh-worklist-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });
  it("wellbeing.share_summary is identical to private.wellbeing_share_cfg()", () => {
    const e = getProposedConfig("wellbeing.share_summary");
    expect(seeded("share-summary-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
  });
  it("the worklist seed is born unsigned and inactive", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => /_s56b_share_summary/.test(f));
    const sql = readFileSync(join(MIGRATIONS, files[0] as string), "utf8");
    expect(/insert into public\.mental_health_worklist_config \(version, is_active, effective_from, rules, notes\)\s*values \(1, false,/.test(sql)).toBe(true);
    expect(sql).not.toMatch(/approved_at\s*=\s*now\(\)[^;]*insert/);
  });
  it("wellbeing.mood_insights and wellbeing.panic_tool are proposed, CMO-owned, and sane", () => {
    const m = getProposedConfig<{ min_days_with_mood: number; min_group_days: number; min_gap: number; window_days: number }>("wellbeing.mood_insights");
    expect(m.status).toBe("proposed");
    expect(m.owner).toBe("CMO");
    expect(m.value.min_days_with_mood).toBeGreaterThanOrEqual(21);
    expect(m.value.min_gap).toBeGreaterThan(0);
    expect(m.value.min_gap).toBeLessThan(1);
    const p = getProposedConfig<{ inhale_seconds: number; exhale_seconds: number; total_seconds: number; grounding_counts: number[] }>("wellbeing.panic_tool");
    expect(p.status).toBe("proposed");
    expect(p.value.exhale_seconds).toBeGreaterThanOrEqual(p.value.inhale_seconds);
    expect(p.value.grounding_counts).toEqual([5, 4, 3, 2, 1]);
  });
});
