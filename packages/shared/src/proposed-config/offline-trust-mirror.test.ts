import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATION = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "supabase", "migrations", "20261013181713_s06x_offline_trust.sql",
);

describe("offline.trust mirrors the S06x migration", () => {
  const source = readFileSync(MIGRATION, "utf8");
  const value = getProposedConfig<{ device_lease_days: number; probe_min_interval_seconds: number }>("offline.trust").value;

  it("device_lease_days equals the column default offline_sync_config.device_lease_days", () => {
    const m = /device_lease_days integer not null default (\d+)/.exec(source);
    if (!m?.[1]) throw new Error("device_lease_days default not found in the migration");
    expect(Number(m[1])).toBe(value.device_lease_days);
  });

  it("rejection_report_daily_cap equals the column default offline_sync_config.rejection_report_daily_cap", () => {
    const m = /rejection_report_daily_cap integer not null default (\d+)/.exec(source);
    if (!m?.[1]) throw new Error("rejection_report_daily_cap default not found in the migration");
    expect(Number(m[1])).toBe((value as unknown as { rejection_report_daily_cap: number }).rejection_report_daily_cap);
  });

  it("the probe is no more than once a minute", () => {
    expect(value.probe_min_interval_seconds).toBeGreaterThanOrEqual(60);
  });
});
