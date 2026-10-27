import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s47b_home_cards_and_readiness.sql"));
  if (!file) throw new Error("S47b migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /home-card-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("home_card_config seed not found in the migration");
  return JSON.parse(match[1]);
}

describe("today.home_cards mirrors the migration seed", () => {
  it("the seed equals the registry entry", () => {
    expect(seed()).toEqual(getProposedConfig("today.home_cards").value);
  });
  it("is PROPOSED and owned by the CMO (an agent never confirms it)", () => {
    const e = getProposedConfig("today.home_cards");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });
  it("never asks for more than two primary actions", () => {
    expect((getProposedConfig("today.home_cards").value as { max_primary_actions: number }).max_primary_actions).toBeLessThanOrEqual(2);
  });
});
