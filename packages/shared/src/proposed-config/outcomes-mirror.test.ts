import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(suffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]);
}
const version = (v: number) => PROPOSED_CONFIG.find((e) => e.key === "outcomes.snapshot_rules" && e.version === v)?.value;

describe("outcomes.snapshot_rules mirrors the migration seeds", () => {
  it("v1 is identical to the outcome_config v1 seed", () => {
    expect(seed("_s38_outcome_snapshots_and_analytics.sql", "outcome-rules")).toEqual(version(1));
  });
  it("v2 is identical to the outcome_config v2 seed", () => {
    expect(seed("_s38b_min_cell_20.sql", "outcome-rules-v2")).toEqual(version(2));
  });
  it("the version in force is v2: the smallest group shown is 20 and a two-attribute cut needs more", () => {
    const v = getProposedConfig("outcomes.snapshot_rules").value as { days: number[]; min_cell: number; min_cell_cross: number; min_readings: number };
    expect(v.days).toEqual([0, 30, 90, 180]);
    expect(v.min_cell).toBe(20);
    expect(v.min_cell_cross).toBeGreaterThan(v.min_cell);
    expect(v.min_readings).toBeGreaterThanOrEqual(2);
  });
});
