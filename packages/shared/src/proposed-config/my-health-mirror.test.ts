import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";
import { LOCK_SCREEN_FIELDS } from "../lock-screen-pass";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): { sharing: unknown; access_log: unknown; lock_screen_pass: { default_enabled: boolean; fields: string[] } } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s09x_my_health_completion.sql"));
  if (!file) throw new Error("S09x migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /my-health-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("my_health_config seed not found in the migration");
  return JSON.parse(match[1]);
}

describe("my_health config mirrors the migration seed", () => {
  it("sharing and access_log match the registry", () => {
    const s = seed();
    const reg = getProposedConfig("my_health.sharing_and_access_log").value as { sharing: unknown; access_log: unknown };
    expect(s.sharing).toEqual(reg.sharing);
    expect(s.access_log).toEqual(reg.access_log);
  });

  it("the lock-screen pass field list matches the registry and the code whitelist", () => {
    const s = seed();
    const reg = getProposedConfig("my_health.lock_screen_pass").value as { default_enabled: boolean; fields: string[] };
    expect(s.lock_screen_pass).toEqual(reg);
    expect([...reg.fields].sort()).toEqual([...LOCK_SCREEN_FIELDS].sort());
  });

  it("the pass is off by default (D4) and the inert show_staff_opens key still matches the signed v1 row (S09x2: the function ignores it)", () => {
    expect((getProposedConfig("my_health.lock_screen_pass").value as { default_enabled: boolean }).default_enabled).toBe(false);
    expect((getProposedConfig("my_health.sharing_and_access_log").value as { access_log: { show_staff_opens: boolean } }).access_log.show_staff_opens).toBe(false);
  });

  it("the 30 day cap is kept and the default expiry is shorter than it", () => {
    const sharing = (getProposedConfig("my_health.sharing_and_access_log").value as { sharing: { default_expiry_hours: number; max_expiry_hours: number; expiry_options_hours: number[] } }).sharing;
    expect(sharing.max_expiry_hours).toBe(720);
    expect(sharing.default_expiry_hours).toBeLessThan(24);
    expect(sharing.expiry_options_hours).toContain(sharing.default_expiry_hours);
    expect(Math.max(...sharing.expiry_options_hours)).toBeLessThanOrEqual(sharing.max_expiry_hours);
  });

  it("the pass carries no clinical-content field", () => {
    const fields = (getProposedConfig("my_health.lock_screen_pass").value as { fields: string[] }).fields;
    for (const banned of ["medications", "conditions", "allergens", "allergies", "readings", "diagnosis"]) expect(fields).not.toContain(banned);
  });
});
