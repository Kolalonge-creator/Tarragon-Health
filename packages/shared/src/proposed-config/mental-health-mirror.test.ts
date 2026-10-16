import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The JSON between a begin and end marker in the S56 migrations. */
function seeded(marker: string): unknown {
  const files = readdirSync(MIGRATIONS).filter((f) => /_s56_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql);
    if (match?.[1]) return JSON.parse(match[1]);
  }
  throw new Error(`${marker} seed not found in any S56 migration`);
}

describe("S56 PROPOSED config mirrors the migration seeds", () => {
  it("mental_health.follow_up_rules is identical to mental_health_follow_up_config v1, proposed and owned by the CMO", () => {
    const e = getProposedConfig("mental_health.follow_up_rules");
    expect(seeded("followup-rules-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });
  it("crisis.card is identical to crisis_card_config v1, proposed and owned by the CMO", () => {
    const e = getProposedConfig("crisis.card");
    expect(seeded("crisis-card-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });
});
