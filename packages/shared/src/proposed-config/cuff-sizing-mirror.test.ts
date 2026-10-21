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

describe("bp.cuff_sizing mirrors the migration seed (S07y)", () => {
  const sql = migration("_s07y_cuff_guidance_and_bp_band_report.sql");

  it("is identical to the bp_cuff_guidance_signoffs version 1 seed", () => {
    const match = /cuff-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("cuff sizing seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("bp.cuff_sizing").value);
    expect(getProposedConfig("bp.cuff_sizing").status).toBe("proposed");
  });

  it("ships unsigned and inactive", () => {
    expect(/values \(1, false, \$json\$/.test(sql)).toBe(true);
    const block = /cuff-config-begin([\s\S]*?)cuff-config-end/.exec(sql)![1]!;
    expect(block).not.toMatch(/approved_by|approved_at/);
  });

  it("covers every whole centimetre from the smallest to the largest size with no gap or overlap", () => {
    const v = getProposedConfig("bp.cuff_sizing").value as { sizes: { minCm: number; maxCm: number }[] };
    const sorted = [...v.sizes].sort((a, b) => a.minCm - b.minCm);
    sorted.slice(1).forEach((s, i) => expect(s.minCm).toBe(sorted[i]!.maxCm + 1));
  });
});
