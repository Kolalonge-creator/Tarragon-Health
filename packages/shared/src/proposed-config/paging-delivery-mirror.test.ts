import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(marker = "paging-delivery-rules-begin", suffix = "_s19c_pager_delivery_hardening.sql"): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = new RegExp(marker + "[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$").exec(sql);
  if (!match?.[1]) throw new Error("paging delivery rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("paging.delivery_rules mirrors the migration seed", () => {
  it("is identical, so the registry and paging_delivery_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("paging.delivery_rules").value);
  });

  it("v2 mirrors the inactive second row and differs from v1 only in switching objective readiness on", () => {
    const v2 = getProposedConfig("paging.delivery_rules_v2").value as Record<string, unknown>;
    expect(seededRules("paging-delivery-rules-v2-begin")).toEqual(v2);
    expect({ ...v2, objective_readiness_required: 0 }).toEqual(getProposedConfig("paging.delivery_rules").value);
    expect((getProposedConfig("paging.delivery_rules").value as { objective_readiness_required: number }).objective_readiness_required).toBe(0);
  });

  it("v3 mirrors its draft migration and differs from v2 only in a 90 day test page window", () => {
    const v2 = getProposedConfig("paging.delivery_rules_v2").value as Record<string, unknown>;
    const v3 = getProposedConfig("paging.delivery_rules_v3").value as Record<string, unknown>;
    expect(seededRules("paging-delivery-rules-v3-begin", "_paging_delivery_config_v3_test_page_90_days_draft.sql")).toEqual(v3);
    expect({ ...v3, readiness_test_page_days: 7 }).toEqual(v2);
    expect(v3.readiness_test_page_days).toBe(90);
    expect(v3.objective_readiness_required).toBe(1);
  });

  it("advances early only ahead of the first 5 minute timer, and keeps the timers themselves", () => {
    const delivery = getProposedConfig("paging.delivery_rules").value as { delivered_ack_seconds: number; delivered_ack_seconds_unconfirmed_route: number };
    expect(delivery.delivered_ack_seconds_unconfirmed_route).toBeGreaterThan(delivery.delivered_ack_seconds);
    const ladder = getProposedConfig("paging.escalation_minutes").value as number[];
    expect(delivery.delivered_ack_seconds).toBeGreaterThan(0);
    expect(delivery.delivered_ack_seconds).toBeLessThan((ladder[0] ?? 0) * 60);
    expect(ladder).toEqual([5, 10]);
  });

  it("is proposed and owned by the CMO, never confirmed by the agent", () => {
    for (const key of ["paging.delivery_rules", "paging.delivery_rules_v3"]) {
      const e = getProposedConfig(key);
      expect(e.owner).toBe("CMO");
      expect(e.status).toBe("proposed");
    }
  });
});
