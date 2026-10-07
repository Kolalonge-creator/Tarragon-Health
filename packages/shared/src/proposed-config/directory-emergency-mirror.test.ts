import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function seed(fileSuffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(fileSuffix));
  if (!file) throw new Error(`${fileSuffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]);
}

describe("S65 versioned config mirrors the migration seeds", () => {
  it("directory.access_rules equals directory_verification_config version 2", () => {
    expect(seed("_s65a_directory_visibility_and_reports.sql", "directory-access")).toEqual(getProposedConfig("directory.access_rules").value);
  });
  it("emergency.pack equals emergency_pack_config version 1", () => {
    expect(seed("_s65c_help_alert_emergency_pack_licence.sql", "emergency-pack")).toEqual(getProposedConfig("emergency.pack").value);
  });
  it("care_circle.help_alert equals care_circle_help_alert_config version 1", () => {
    expect(seed("_s65c_help_alert_emergency_pack_licence.sql", "help-alert")).toEqual(getProposedConfig("care_circle.help_alert").value);
  });
  it("the Q21 cadence is 90 / 90 / 180 / 180 / 365 and hides at twice the cadence", () => {
    const v = getProposedConfig<{ visibility: { cadence_days: Record<string, number>; hide_multiple: number } }>("directory.access_rules").value.visibility;
    expect(v.cadence_days).toEqual({ emergency_hospital: 90, pharmacy_24h: 90, clinic: 180, lab: 180, other: 365 });
    expect(v.hide_multiple).toBe(2);
  });
  it("all four S65 entries are proposed and unsigned", () => {
    for (const k of ["directory.access_rules", "emergency.pack", "vitals.device_red_rules", "care_circle.help_alert"]) {
      expect(getProposedConfig(k).status).toBe("proposed");
    }
    expect(getProposedConfig<{ signed: unknown }>("emergency.pack").value.signed).toBeNull();
  });
});
