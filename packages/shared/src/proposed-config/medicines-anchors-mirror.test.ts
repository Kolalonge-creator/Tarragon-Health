import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATION = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "..", "supabase", "migrations", "20261021011847_s08z_dose_time_anchors.sql",
);

interface AnchorsConfig {
  anchors: Record<string, string>;
  offset_choices_minutes: number[];
  shift_offset_choices_minutes: number[];
  max_shift_days: number;
  max_shift_offset_minutes: number;
}

describe("medicines.dose_anchors mirrors the S08z migration", () => {
  const source = readFileSync(MIGRATION, "utf8");
  const value = getProposedConfig("medicines.dose_anchors").value as unknown as AnchorsConfig;

  it("the ten starting times seeded into dose_anchor_defaults equal the registry's", () => {
    const block = /insert into public\.dose_anchor_defaults \(anchor, default_time\) values([\s\S]*?)on conflict/.exec(source)?.[1];
    if (!block) throw new Error("dose_anchor_defaults seed not found in the migration");
    const seeded: Record<string, string> = {};
    for (const m of block.matchAll(/\('([a-z_]+)', '(\d{2}:\d{2})'\)/g)) seeded[m[1] as string] = m[2] as string;
    expect(seeded).toEqual(value.anchors);
    expect(Object.keys(seeded)).toHaveLength(10);
  });

  it("the anchor list in the table check constraint and in the database helper is the same ten names", () => {
    const names = Object.keys(value.anchors).sort();
    const tableCheck = /create table if not exists public\.dose_anchor_defaults[\s\S]*?check \(anchor in \(([^)]*)\)\)/.exec(source)?.[1] ?? "";
    expect([...tableCheck.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual(names);
    const helper = /private\.dose_anchor_ids\(\)[\s\S]*?array\[([^\]]*)\]/.exec(source)?.[1] ?? "";
    expect([...helper.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual(names);
  });

  it("max_shift_days equals the table constraint on patient_day_shifts", () => {
    const m = /ends_on - starts_on \+ 1 <= (\d+)/.exec(source);
    if (!m?.[1]) throw new Error("shift length constraint not found in the migration");
    expect(Number(m[1])).toBe(value.max_shift_days);
  });

  it("max_shift_offset_minutes equals the database's bound on an offset", () => {
    const m = /schedule_int_ok\(e\.value, -(\d+), (\d+)\)/.exec(source);
    if (!m?.[1] || !m[2]) throw new Error("shift offset bound not found in the migration");
    expect(Number(m[1])).toBe(value.max_shift_offset_minutes);
    expect(Number(m[2])).toBe(value.max_shift_offset_minutes);
  });

  it("every offset the phone offers is one the database accepts", () => {
    for (const o of value.offset_choices_minutes) {
      expect(o).toBeGreaterThanOrEqual(-120);
      expect(o).toBeLessThanOrEqual(180);
    }
    for (const o of value.shift_offset_choices_minutes) expect(Math.abs(o)).toBeLessThanOrEqual(value.max_shift_offset_minutes);
    expect(value.offset_choices_minutes).toContain(0);
    expect(value.shift_offset_choices_minutes).toContain(0);
  });

  it("each starting time is a valid time of day", () => {
    for (const t of Object.values(value.anchors)) expect(t).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
});
