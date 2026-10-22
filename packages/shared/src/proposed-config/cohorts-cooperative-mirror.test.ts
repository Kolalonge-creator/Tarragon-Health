import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const file = readdirSync(DIR).find((f) => f.endsWith("_s69c_cooperative_shared_goal.sql"));
const sql = readFileSync(join(DIR, file ?? "missing"), "utf8");

function seeded(): Record<string, unknown> {
  const match = /coop-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("cooperative rules seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("cohorts.cooperative mirrors the migration seed", () => {
  it("is identical, so the registry and cohort_coop_config cannot drift", () => {
    expect(file).toBeDefined();
    expect(seeded()).toEqual(getProposedConfig("cohorts.cooperative").value);
  });

  it("is proposed and signs nothing", () => {
    const e = getProposedConfig("cohorts.cooperative");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    expect(/status\s*=\s*'approved'/.test(sql)).toBe(false);
  });

  it("the migration has a real-clock name, not a round hand-typed one", () => {
    expect(file).toMatch(/^2026\d{10}_s69c_/);
    expect(file).not.toMatch(/0000_s69c_/);
  });

  it("keeps only the day of an event: no timestamp column on a member's effort or skip rows, and no notification on skip", () => {
    expect(sql).toMatch(/alter column created_at type date/);
    const skipTable = /create table public\.challenge_skips \(([\s\S]*?)\);/.exec(sql)?.[1] ?? "";
    expect(skipTable).not.toMatch(/timestamptz|timestamp/);
    const skipFn = /create function public\.skip_challenge_week[\s\S]*?end \$\$;/.exec(sql)?.[0] ?? "";
    expect(skipFn.length).toBeGreaterThan(0);
    expect(skipFn).not.toMatch(/cohort_notify|emit_domain_event|insert into public\.notifications|log_audit\(/);
  });

  it("the daily cap is read from configuration, not hard-coded in the trigger", () => {
    const trig = /create function private\.challenge_participation_daily_cap[\s\S]*?end \$\$;/.exec(sql)?.[0] ?? "";
    expect(trig).toMatch(/cohort_coop_rules\(\)/);
    expect(trig).not.toMatch(/:= 5\b|:= 3\b/);
  });
});
