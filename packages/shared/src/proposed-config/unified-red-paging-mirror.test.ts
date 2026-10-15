import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s19d_unified_red_event_paging_flag_off.sql"));
  if (!file) throw new Error("S19d migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function seededRules(): Record<string, unknown> {
  const match = /unified-red-paging-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migrationSql());
  if (!match?.[1]) throw new Error("unified red paging rules seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("paging.unified_red_rules mirrors the migration seed", () => {
  it("is identical, so the registry and unified_red_paging_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("paging.unified_red_rules").value);
  });

  it("is proposed and owned by the CMO, never confirmed by the agent", () => {
    const e = getProposedConfig("paging.unified_red_rules");
    expect(e.owner).toBe("CMO");
    expect(e.status).toBe("proposed");
  });

  it("ships the config inactive and unsigned: nothing in the migration activates or signs a version", () => {
    const sql = migrationSql();
    expect(/insert into public\.unified_red_paging_config \(version, is_active, effective_from, rules\) values \(1, false,/.test(sql)).toBe(true);
    expect(sql).not.toMatch(/update public\.unified_red_paging_config set is_active = true/);
    expect(sql).not.toMatch(/perform public\.sign_unified_red_paging_config/);
  });

  it("does not hook the abnormal screening pipeline or the blood pressure handler", () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/handle_bp_reading_red_flag/);
    expect(sql).not.toMatch(/abnormal_screening/);
  });
});
