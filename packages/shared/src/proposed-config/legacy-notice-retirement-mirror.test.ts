import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s19f_legacy_notice_retirement_and_circle_page_notice.sql"));
  if (!file) throw new Error("S19f migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/** version number -> rules, read from the seed block of the migration. */
function seededVersions(): Record<string, unknown> {
  const block = /legacy-notice-retirement-rules-begin([\s\S]*?)legacy-notice-retirement-rules-end/.exec(migrationSql());
  if (!block?.[1]) throw new Error("legacy notice retirement seed not found in the migration");
  const out: Record<string, unknown> = {};
  for (const m of block[1].matchAll(/\((\d+), false, '[0-9-]+', \$json\$([\s\S]*?)\$json\$::jsonb\)/g)) {
    out[m[1] as string] = JSON.parse(m[2] as string);
  }
  return out;
}

type Versions = Record<string, Record<string, number>>;

describe("paging.legacy_notice_retirement_rules mirrors the migration seed", () => {
  it("is identical for all four versions, so the registry and legacy_notice_retirement_config cannot drift", () => {
    const seeded = seededVersions();
    expect(Object.keys(seeded)).toEqual(["1", "2", "3", "4"]);
    expect(seeded).toEqual((getProposedConfig("paging.legacy_notice_retirement_rules").value as { versions: Versions }).versions);
  });

  it("keeps the emergency key separate: only version 3 retires an emergency broadcast, and only together with a red-level one", () => {
    const v = (getProposedConfig("paging.legacy_notice_retirement_rules").value as { versions: Versions }).versions;
    for (const [k, r] of Object.entries(v)) {
      if (r.suppress_legacy_emergency_notice === 1) {
        expect(k).toBe("3");
        expect(r.suppress_legacy_bp_notice === 1 || r.suppress_legacy_glucose_notice === 1).toBe(true);
      }
    }
    expect(v["1"]?.suppress_legacy_bp_notice).toBe(0);
    expect(v["1"]?.suppress_legacy_glucose_notice).toBe(0);
    expect(v["1"]?.circle_notice_unified_page).toBe(0);
  });

  it("is proposed and owned by the CMO, never confirmed by the agent", () => {
    const e = getProposedConfig("paging.legacy_notice_retirement_rules");
    expect(e.owner).toBe("CMO");
    expect(e.status).toBe("proposed");
  });

  it("ships every version inactive and unsigned: nothing in the migration activates or signs one", () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/update public\.legacy_notice_retirement_config set is_active = true/);
    expect(sql).not.toMatch(/perform public\.sign_legacy_notice_retirement_config/);
    expect(sql).not.toMatch(/\(\d+, true,/);
  });

  it("does not hook the abnormal screening pipeline", () => {
    expect(migrationSql()).not.toMatch(/abnormal_screening/);
  });
});
