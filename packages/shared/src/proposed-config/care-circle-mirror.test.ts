import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The rules the latest S29 migration seeds: later migrations (s29c) bring a new version between their own begin/end markers. */
function seededRules(): Record<string, unknown> {
  const files = readdirSync(MIGRATIONS).filter((f) => /_s29[a-z]?_.*\.sql$/.test(f)).sort();
  let latest: string | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const match = /care-circle-rules(?:-v\d+)?-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (match?.[1]) latest = match[1];
  }
  if (!latest) throw new Error("care circle rules seed not found in any S29 migration");
  return JSON.parse(latest) as Record<string, unknown>;
}

describe("care_circle.rules mirrors the migration seed", () => {
  it("is identical, so the registry and care_circle_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("care_circle.rules").value);
  });

  it("is proposed, owned by the founder, and carries every key the database validates", () => {
    const e = getProposedConfig("care_circle.rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    expect(Object.keys(e.value as object).sort()).toEqual(["alert_visible_hours", "default_grant_days", "expiry_final_notice_days", "expiry_notice_days", "gift_decide_days", "invite_ttl_hours", "max_attempts", "max_invites_per_day", "max_members", "pause_days", "view_weeks"]);
  });
});
