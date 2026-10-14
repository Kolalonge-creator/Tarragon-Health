import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seeded(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_p1_chain_canary.sql"));
  if (!file) throw new Error("P1 canary migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const block = /chain-canary-config-begin([\s\S]*?)chain-canary-config-end/.exec(sql)?.[1];
  if (!block) throw new Error("config seed markers not found");
  const json = /'(\{[\s\S]*\})'::jsonb/.exec(block)?.[1];
  if (!json) throw new Error("config seed json not found");
  return JSON.parse(json) as Record<string, unknown>;
}

describe("chain.canary_and_health mirrors the P1 migration seed", () => {
  it("is identical, so the registry and chain_canary_config cannot drift", () => {
    expect(seeded()).toEqual(getProposedConfig("chain.canary_and_health").value);
  });
  it("schedules the cron job off the round minutes and not per minute", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_p1_chain_canary.sql")) as string;
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    expect(sql).toContain("cron.schedule('chain-canary', '11,41 * * * *'");
  });
});
