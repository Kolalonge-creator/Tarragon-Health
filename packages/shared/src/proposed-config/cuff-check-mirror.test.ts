import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("bp.cuff_check mirrors the migration seed (S07y)", () => {
  const sql = migration("_s07y_home_cuff_vs_clinic_check.sql");

  it("is identical to the cuff_check_rules version 1 seed", () => {
    const match = /cuff-check-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("cuff check config seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("bp.cuff_check").value);
    expect(getProposedConfig("bp.cuff_check").version).toBe(1);
  });

  it("ships unsigned and inactive, and stays PROPOSED (nothing here is confirmed)", () => {
    expect(/values \(1, false, \$json\$/.test(sql)).toBe(true);
    const seedBlock = /cuff-check-config-begin([\s\S]*?)cuff-check-config-end/.exec(sql)![1]!;
    expect(seedBlock).not.toMatch(/approved_by|approved_at/);
    expect(getProposedConfig("bp.cuff_check").status).toBe("proposed");
  });

  it("creates the task type and both go-live guards, born off", () => {
    expect(sql).toContain("'cuff_check_review', 1, 8, 10080");
    expect(sql).toMatch(/\('cuff_check_flag',[\s\S]*?\n\s+\('cuff_visit_prompt'/);
    // the guard table's is_on defaults to false and the insert does not name it
    expect(sql).not.toMatch(/insert into public\.go_live_guards \([^)]*is_on/);
  });
});
