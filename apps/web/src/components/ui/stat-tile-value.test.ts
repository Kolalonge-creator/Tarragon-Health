import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { statTileValue } from "./stat-tile-value";

/**
 * StatTile's documented contract: a tile shows either a real display-scale
 * value or a friendly muted hint, never a bare display-scale "—". The
 * discriminated union in stat-tile.tsx enforces the shape but not the
 * content, so six patient tiles satisfied the types while still rendering a
 * dash by folding the empty case into the value string. These cover both
 * halves: the helper that builds the union, and a scan proving no call site
 * has quietly gone back to the dash.
 */

describe("statTileValue", () => {
  it("returns the value side for a real reading", () => {
    expect(statTileValue("120/80", "No reading yet", "mmHg")).toEqual({
      value: "120/80",
      unit: "mmHg",
    });
  });

  it("stringifies a numeric value", () => {
    expect(statTileValue(5.4, "No reading yet", "mmol/L")).toEqual({
      value: "5.4",
      unit: "mmol/L",
    });
  });

  it("keeps a legitimate zero as a value", () => {
    // A caller that wants "0 doses due" to read as a hint passes null; a
    // plain 0 is still a real count and must not silently become a hint.
    expect(statTileValue(0, "Nothing due today")).toEqual({ value: "0" });
  });

  it("returns the hint side, with no unit, when there is nothing to show", () => {
    for (const absent of [null, undefined, ""]) {
      expect(statTileValue(absent, "No reading yet", "mmHg")).toEqual({
        empty: { hint: "No reading yet" },
      });
    }
  });

  it("omits `unit` entirely when none is given, rather than passing undefined", () => {
    expect(Object.keys(statTileValue("3", "None yet"))).toEqual(["value"]);
  });
});

describe("StatTile call sites", () => {
  const FILES = [
    "src/app/(dashboard)/patient/(sections)/page.tsx",
    "src/app/(dashboard)/patient/weight/weight-client.tsx",
  ];

  it.each(FILES)("%s never passes a dash as a StatTile value", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    // Matches `value={... : "—"}` / `value="—"` — the exact shape that let a
    // display-scale dash through the union.
    expect(source).not.toMatch(/value=\{?[^\n]*"—"/);
  });
});
