import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s19c_pager_delivery_hardening.sql"));
  if (!file) throw new Error("S19c migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /paging-delivery-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("paging delivery rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("paging.delivery_rules mirrors the migration seed", () => {
  it("is identical, so the registry and paging_delivery_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("paging.delivery_rules").value);
  });

  it("advances early only ahead of the first 5 minute timer, and keeps the timers themselves", () => {
    const delivery = getProposedConfig("paging.delivery_rules").value as { delivered_ack_seconds: number };
    const ladder = getProposedConfig("paging.escalation_minutes").value as number[];
    expect(delivery.delivered_ack_seconds).toBeGreaterThan(0);
    expect(delivery.delivered_ack_seconds).toBeLessThan((ladder[0] ?? 0) * 60);
    expect(ladder).toEqual([5, 10]);
  });

  it("is proposed and owned by the CMO, never confirmed by the agent", () => {
    const e = getProposedConfig("paging.delivery_rules");
    expect(e.owner).toBe("CMO");
    expect(e.status).toBe("proposed");
  });
});
