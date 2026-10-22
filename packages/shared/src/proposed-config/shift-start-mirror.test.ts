import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_shift_start_test_page.sql"));
  if (!file) throw new Error("shift start migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /shift-start-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("shift start rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("shift_start.test_rules mirrors the migration seed", () => {
  it("is identical, so the registry and shift_start_test_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("shift_start.test_rules").value);
  });
  it("is proposed, owned by the CMO, with sane relations", () => {
    const e = getProposedConfig("shift_start.test_rules");
    expect(e.owner).toBe("CMO");
    expect(e.status).toBe("proposed");
    const v = e.value as { lead_minutes: number; grace_minutes: number; undelivered_after_minutes: number };
    expect(v.undelivered_after_minutes).toBeLessThan(v.lead_minutes + v.grace_minutes);
  });
});
