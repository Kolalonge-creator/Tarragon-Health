import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(suffix = "_s19_red_event_paging.sql", marker = "paging-rules-begin"): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ${suffix} not found`);
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = new RegExp(`${marker}[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql);
  if (!match?.[1]) throw new Error("paging rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("paging.rules mirrors the migration seed", () => {
  it("is identical, so the registry and paging_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("paging.rules").value);
  });

  it("repeats the spec escalation times (5 and 10 minutes)", () => {
    const rules = getProposedConfig("paging.rules").value as { escalation_minutes: number[] };
    expect(rules.escalation_minutes).toEqual(getProposedConfig("paging.escalation_minutes").value);
  });

  it("paging_config version 2 (PROPOSED, inactive) is paging.rules plus the paging.watchdog keys", () => {
    const wd = getProposedConfig("paging.watchdog");
    expect(wd.status).toBe("proposed");
    expect(seededRules("_s78a_paging_watchdog_and_repage.sql", "paging-rules-v2-begin")).toEqual({
      ...(getProposedConfig("paging.rules").value as Record<string, unknown>),
      ...(wd.value as Record<string, unknown>),
    });
    expect((wd.value as Record<string, unknown>).repage_after_ack_minutes).toBeNull();
  });
});
