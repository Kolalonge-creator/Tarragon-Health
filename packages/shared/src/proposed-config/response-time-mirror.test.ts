import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): { rules: Record<string, unknown>; sql: string } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s78b_response_time_config_and_breach_path.sql"));
  if (!file) throw new Error("S78b migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /response-time-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("response time seed not found");
  return { rules: JSON.parse(match[1]) as Record<string, unknown>, sql };
}

describe("response_time.targets mirrors the migration seed", () => {
  it("is identical, so the registry and response_time_config cannot drift", () => {
    expect(seed().rules).toEqual(getProposedConfig("response_time.targets").value);
  });

  it("is proposed and the seed row is inactive (CMO decision S-9: no numbers published)", () => {
    expect(getProposedConfig("response_time.targets").status).toBe("proposed");
    const { sql } = seed();
    expect(/insert into public\.response_time_config \(version, is_active, effective_from, rules, note\) values \(1, false,/.test(sql)).toBe(true);
  });
});
