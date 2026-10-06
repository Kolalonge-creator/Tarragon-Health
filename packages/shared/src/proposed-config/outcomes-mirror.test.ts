import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("outcomes.snapshot_rules mirrors the migration seed", () => {
  it("is identical to the outcome_config seed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s38_outcome_snapshots_and_analytics.sql"));
    if (!file) throw new Error("S38 migration not found");
    const match = /outcome-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("outcome rules seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("outcomes.snapshot_rules").value);
  });

  it("the spec's days and the research-backed cell sizes hold", () => {
    const v = getProposedConfig("outcomes.snapshot_rules").value as { days: number[]; min_cell: number; min_cell_cross: number; min_readings: number };
    expect(v.days).toEqual([0, 30, 90, 180]);
    expect(v.min_cell).toBeGreaterThanOrEqual(11);
    expect(v.min_cell_cross).toBeGreaterThan(v.min_cell);
    expect(v.min_readings).toBeGreaterThanOrEqual(2);
  });
});
