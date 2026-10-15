import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

type Rules = {
  batchSize: number; leaseSeconds: number; maxAttempts: number; backoffBaseSeconds: number; backoffMaxSeconds: number;
  jitterPercent: number; lagAlertSeconds: number; lagAlertFloorSeconds: number; partnerDisableAfterFailures: number; partnerDisableFloor: number;
};

describe("events.bus_rules mirrors the S10x migrations", () => {
  const resolved = getProposedConfig("events.bus_rules", "2026-10-13");
  const rules = resolved.value as Rules;

  it("resolves to version 2 of the registry entry", () => {
    expect(resolved.version).toBe(2);
  });

  it("matches the version 3 config row the migrations leave active", () => {
    const sql = migration("_s10x_b_partner_webhook_subscriber.sql");
    const m = /values \(3, true, (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),\s*(\d+), (\d+),/.exec(sql);
    if (!m) throw new Error("version 3 config seed not found");
    const [batch, lease, attempts, base, max, jitter, lag, partner] = m.slice(1).map(Number);
    expect({ batch, lease, attempts, base, max, jitter, lag, partner }).toEqual({
      batch: rules.batchSize, lease: rules.leaseSeconds, attempts: rules.maxAttempts, base: rules.backoffBaseSeconds,
      max: rules.backoffMaxSeconds, jitter: rules.jitterPercent, lag: rules.lagAlertSeconds, partner: rules.partnerDisableAfterFailures,
    });
  });

  it("matches the floors the database enforces", () => {
    expect(migration("_s10x_a_bus_operations.sql")).toContain(`check (lag_alert_seconds >= ${rules.lagAlertFloorSeconds})`);
    expect(migration("_s10x_b_partner_webhook_subscriber.sql")).toContain(`check (partner_disable_after_failures >= ${rules.partnerDisableFloor})`);
  });

  it("keeps the original S10 values for dates before S10x", () => {
    expect(getProposedConfig("events.bus_rules", "2026-10-06").version).toBe(1);
  });
});
