import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const DIR = join(ROOT, "supabase", "migrations");
function migration(suffix: string): string {
  const f = readdirSync(DIR).find((n) => n.endsWith(suffix));
  if (!f) throw new Error(`migration ${suffix} not found`);
  return readFileSync(join(DIR, f), "utf8");
}
const SUFFIX = "_s26b_entitlement_and_refund_hardening.sql";

describe("the S26b entitlement and refund config mirrors the migration", () => {
  it("entitlements.lifecycle is the lifecycle seed: reminders at 30, 7 and 1 day, 7 days of read-only grace", () => {
    const m = /entitlements-lifecycle-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration(SUFFIX));
    if (!m?.[1]) throw new Error("lifecycle seed not found in the migration");
    const v = getProposedConfig("entitlements.lifecycle").value as { reminder_days_before: number[]; grace_days: number };
    expect(JSON.parse(m[1])).toEqual(v);
    expect(v.reminder_days_before).toEqual([30, 7, 1]);
    expect(v.grace_days).toBe(7);
  });

  it("refunds.order_rules is the refund_rules seed", () => {
    const m = /refunds-order-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migration(SUFFIX));
    if (!m?.[1]) throw new Error("refund rules seed not found in the migration");
    const v = getProposedConfig("refunds.order_rules").value as Record<string, number>;
    expect(JSON.parse(m[1])).toEqual(v);
    expect(v["cooling_off_days"]).toBe(14);
  });

  it("the shipped defaults in private.entitlement_policy equal the seeds, so a missing row never changes a rule", () => {
    const sql = migration(SUFFIX);
    const lifecycle = getProposedConfig("entitlements.lifecycle").value;
    const rules = getProposedConfig("refunds.order_rules").value;
    const l = /when 'lifecycle' then '(\{[^']*\})'::jsonb/.exec(sql);
    const r = /else '(\{[^']*\})'::jsonb/.exec(sql);
    if (!l?.[1] || !r?.[1]) throw new Error("defaults not found");
    expect(JSON.parse(l[1])).toEqual(lifecycle);
    expect(JSON.parse(r[1])).toEqual(rules);
  });

  it("the reminder cron no longer chooses a channel of its own", () => {
    const route = readFileSync(join(ROOT, "apps", "web", "src", "app", "api", "cron", "entitlement-reminders", "route.ts"), "utf8");
    expect(route).not.toMatch(/channel:\s*"in_app"/);
    expect(route).toMatch(/service_run_entitlement_reminders/);
  });
});
