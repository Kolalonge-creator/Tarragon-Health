import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(suffix: string, marker: string): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

type Rules = {
  lookup_failure_alert_per_hour: number;
  record_open_window_hours: number;
  untied_open_alert_per_hour: number;
  after_hours_start: number;
  after_hours_end: number;
  retention: Record<string, number | boolean>;
};
const live = () => getProposedConfig("security.rules").value as Rules;

describe("security.rules mirrors the migration seeds", () => {
  it("v3 is identical to the security_config v3 seed", () => {
    expect(seed("_s39d_data_registry_purge_export.sql", "security-rules-v3")).toEqual(live());
  });
  it("v2 (S39c) is v3 without the export review clock", () => {
    const { export_review_days: _omit, ...rest } = live() as Rules & { export_review_days: number };
    void _omit;
    expect(seed("_s39c_audited_record_access.sql", "security-rules-v2")).toEqual(rest);
  });
  it("the export review clock is 30 days", () => {
    expect((live() as Rules & { export_review_days: number }).export_review_days).toBe(30);
  });
  it("v1 is still the S39 seed and its threshold is unchanged in v2", () => {
    expect(seed("_s39_security_hardening_round1.sql", "security-rules")).toEqual({ lookup_failure_alert_per_hour: live().lookup_failure_alert_per_hour });
  });
  it("the thresholds are positive whole numbers", () => {
    for (const k of ["lookup_failure_alert_per_hour", "record_open_window_hours", "untied_open_alert_per_hour"] as const) {
      expect(Number.isInteger(live()[k])).toBe(true);
      expect(live()[k]).toBeGreaterThan(0);
    }
  });
  it("the after-hours band is a pair of Lagos hours", () => {
    for (const h of [live().after_hours_start, live().after_hours_end]) {
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    }
  });
  it("retention carries the agreed international periods and never auto-deletes real data", () => {
    const r = live().retention;
    expect(r).toMatchObject({
      adult_clinical_record_years_after_last_contact: 8,
      child_record_until_age: 25,
      child_record_until_age_if_seen_at_17: 26,
      maternity_record_years: 25,
      mental_health_years_after_last_contact: 20,
      access_audit_log_years: 8,
      consent_years_after_relationship_end: 6,
      payments_ledger_years: 6,
      operational_data_days_min: 90,
      operational_data_days_max: 730,
      real_data_auto_delete: false,
    });
  });
  it("the access log outlives the clinical record it describes", () => {
    const r = live().retention;
    expect(r.access_audit_log_years as number).toBeGreaterThanOrEqual(r.adult_clinical_record_years_after_last_contact as number);
  });
});
