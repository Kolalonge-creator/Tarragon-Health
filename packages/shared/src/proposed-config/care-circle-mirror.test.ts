import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s29_care_circle.sql"));
  if (!file) throw new Error("S29 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /care-circle-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("care circle rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("care_circle.rules mirrors the migration seed", () => {
  it("is identical, so the registry and care_circle_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("care_circle.rules").value);
  });

  it("is proposed, owned by the founder, and carries every key the database validates", () => {
    const e = getProposedConfig("care_circle.rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    expect(Object.keys(e.value as object).sort()).toEqual(["default_grant_days", "invite_ttl_hours", "max_attempts", "max_invites_per_day", "max_members", "view_weeks"]);
  });
});
