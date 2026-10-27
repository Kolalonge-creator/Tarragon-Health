import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATION = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "supabase", "migrations", "20261020181520_s07y_reading_provenance_pharmacy_and_paper_diary.sql",
);
const OFFLINE = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "supabase", "migrations", "20261002205313_s06_offline_client_recorded_time.sql",
);

describe("vitals.diary_import mirrors the S07y migration", () => {
  const source = readFileSync(MIGRATION, "utf8");
  const offline = readFileSync(OFFLINE, "utf8");
  const value = getProposedConfig<{ window_days: number; future_skew_minutes: number; max_rows_per_save: number; max_photo_bytes: number; max_reads_per_hour: number }>("vitals.diary_import").value;

  it("window_days equals the column default offline_sync_config.diary_window_days", () => {
    const m = /diary_window_days integer not null default (\d+)/.exec(source);
    if (!m?.[1]) throw new Error("diary_window_days default not found in the migration");
    expect(Number(m[1])).toBe(value.window_days);
  });

  it("the window stays inside the column's own check (1 to 90 days)", () => {
    const m = /diary_window_days between (\d+) and (\d+)/.exec(source);
    if (!m?.[1] || !m[2]) throw new Error("diary_window_days check not found in the migration");
    expect(value.window_days).toBeGreaterThanOrEqual(Number(m[1]));
    expect(value.window_days).toBeLessThanOrEqual(Number(m[2]));
  });

  it("future_skew_minutes equals the seeded offline_sync_config row the server stamps with", () => {
    // values (1, true, 72, 5, 12, 1, 10, ...): version, active, window hours, skew minutes, ...
    const m = /values \(1, true, (\d+), (\d+),/.exec(offline);
    if (!m?.[2]) throw new Error("offline_sync_config seed not found");
    expect(Number(m[2])).toBe(value.future_skew_minutes);
  });

  it("the row and photo caps are sane", () => {
    expect(value.max_rows_per_save).toBeGreaterThanOrEqual(1);
    expect(value.max_rows_per_save).toBeLessThanOrEqual(50);
    expect(value.max_photo_bytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(value.max_reads_per_hour).toBeGreaterThanOrEqual(1);
  });
});
