import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";
import { en } from "./index";

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "migrations", "20261007131712_s42_consent_matrix.sql"), "utf8");
const TYPES = ["vitals", "reproductive", "mental_health", "documents", "device_data"];
const PURPOSES = ["care", "care_circle_sharing", "research", "sponsor_reporting"];

describe("consent matrix wording keys (S42)", () => {
  it("every cell has a placeholder text key, a data type label and a purpose label", () => {
    for (const d of TYPES) {
      expect([d, `consent.data.${d}` in en]).toEqual([d, true]);
      for (const p of PURPOSES) {
        expect([d, p, `consent.matrix.${d}.${p}` in en]).toEqual([d, p, true]);
      }
    }
    for (const p of PURPOSES) expect([p, `consent.purpose.${p}` in en]).toEqual([p, true]);
  });

  it("every bundle the migration seeds has a title and a body", () => {
    const codes = [...SQL.matchAll(/\('([a-z_]+)', 'consent\.bundle\.[a-z_]+', \d\)/g)].map((m) => m[1] as string);
    expect(codes.length).toBeGreaterThanOrEqual(3);
    for (const c of codes) {
      expect([c, `consent.bundle.${c}` in en]).toEqual([c, true]);
      expect([c, `consent.bundle.${c}.body` in en]).toEqual([c, true]);
    }
  });

  it("the migration's text keys are the keys the catalogue holds", () => {
    expect(SQL).toContain("'consent.matrix.' || d.dt || '.' || p.pu");
  });
});
