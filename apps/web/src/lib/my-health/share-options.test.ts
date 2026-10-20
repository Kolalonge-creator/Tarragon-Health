import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { SHARE_MAX_VIEWS_CHOICES, SHARE_WINDOW_DAYS_CHOICES, viewsLeft } from "./share-options";

describe("share options", () => {
  it("counts the openings left, never below zero, and null when there is no cap", () => {
    expect(viewsLeft(null, 7)).toBeNull();
    expect(viewsLeft(3, 0)).toBe(3);
    expect(viewsLeft(3, 2)).toBe(1);
    expect(viewsLeft(3, 3)).toBe(0);
    expect(viewsLeft(3, 9)).toBe(0);
  });

  it("only offers choices the database accepts (mirror of the migration constraints)", () => {
    const dir = join(process.cwd(), "..", "..", "supabase", "migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_record_share_recipient_views_window.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file as string), "utf8");
    const maxRange = /max_views between (\d+) and (\d+)/.exec(sql);
    const windows = /window_days in \(([\d, ]+)\)/.exec(sql);
    expect(maxRange).not.toBeNull();
    expect(windows).not.toBeNull();
    for (const n of SHARE_MAX_VIEWS_CHOICES) {
      expect(n).toBeGreaterThanOrEqual(Number(maxRange?.[1]));
      expect(n).toBeLessThanOrEqual(Number(maxRange?.[2]));
    }
    const allowed = (windows?.[1] ?? "").split(",").map((x) => Number(x.trim()));
    for (const d of SHARE_WINDOW_DAYS_CHOICES) expect(allowed).toContain(d);
  });
});
