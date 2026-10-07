import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function sql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s70_devices_dedup_events_cgm.sql"));
  if (!file) throw new Error("S70 migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}
function seed(marker: string): unknown {
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql());
  if (!match?.[1]) throw new Error(`${marker} seed not found in the migration`);
  return JSON.parse(match[1]);
}

describe("devices.* mirrors the S70 device_config seeds", () => {
  it("devices.dedup_rules is identical to the dedup seed", () => {
    expect(seed("dedup")).toEqual(getProposedConfig("devices.dedup_rules").value);
  });
  it("devices.cgm_events is identical to the cgm_events seed", () => {
    expect(seed("cgm")).toEqual(getProposedConfig("devices.cgm_events").value);
  });
  it("devices.device_alert is identical to the device_alert seed", () => {
    expect(seed("device-alert")).toEqual(getProposedConfig("devices.device_alert").value);
  });
  it("the CMO pack figures hold: BP 10 minutes, glucose 5 minutes, low 3.0 for 15, low 3.9 for 60, high 13.9 for 120, one working day", () => {
    const dedup = getProposedConfig("devices.dedup_rules").value as { types: Record<string, { window_minutes: number }> };
    expect(dedup.types.blood_pressure?.window_minutes).toBe(10);
    expect(dedup.types.glucose?.window_minutes).toBe(5);
    const cgm = getProposedConfig("devices.cgm_events").value as { events: { code: string; threshold_mmol_l: number; min_minutes: number }[] };
    const by = (c: string) => cgm.events.find((e) => e.code === c);
    expect([by("cgm_severe_low")?.threshold_mmol_l, by("cgm_severe_low")?.min_minutes]).toEqual([3.0, 15]);
    expect([by("cgm_low")?.threshold_mmol_l, by("cgm_low")?.min_minutes]).toEqual([3.9, 60]);
    expect([by("cgm_high")?.threshold_mmol_l, by("cgm_high")?.min_minutes]).toEqual([13.9, 120]);
    expect((getProposedConfig("devices.device_alert").value as { ecg_due_minutes: number }).ecg_due_minutes).toBe(1440);
  });
  it("the device_alert_review task type seed matches the documented class and due time", () => {
    const m = /task-types-s70-begin([\s\S]*?)task-types-s70-end/.exec(sql())?.[1] ?? "";
    expect(m).toMatch(/'device_alert_review', 1, 7, 1440, 'medical_officer'/);
    expect(m).toMatch(/creatable|true, true/);
  });
  it("no agent confirmed a value: every devices entry is proposed", () => {
    for (const k of ["devices.dedup_rules", "devices.cgm_events", "devices.device_alert", "devices.photo_capture"]) {
      expect(getProposedConfig(k).status).toBe("proposed");
    }
  });
});
