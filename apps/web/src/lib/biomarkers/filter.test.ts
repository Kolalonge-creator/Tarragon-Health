import type { TrendPoint } from "@tarragon/shared";
import { filterTrendPoints, parseTrendRange, sourcesIn } from "./filter";

const pt = (takenAt: string, source: string): TrendPoint => ({ takenAt, source, value: 5, unit: "mmol/L" }) as TrendPoint;
const now = new Date("2026-10-29T12:00:00Z");
const points = [pt("2024-01-10T00:00:00Z", "lab_result"), pt("2026-08-01T00:00:00Z", "legacy_report"), pt("2026-10-01T00:00:00Z", "lab_result")];

describe("biomarker trend filters", () => {
  it("defaults an unknown range to all", () => {
    expect(parseTrendRange("bogus")).toBe("all");
    expect(parseTrendRange("6m")).toBe("6m");
  });
  it("keeps only points inside the window", () => {
    expect(filterTrendPoints(points, "3m", undefined, now)).toHaveLength(2);
    expect(filterTrendPoints(points, "1y", undefined, now)).toHaveLength(2);
    expect(filterTrendPoints(points, "all", undefined, now)).toHaveLength(3);
  });
  it("filters by source and combines with range", () => {
    expect(filterTrendPoints(points, "all", "lab_result", now)).toHaveLength(2);
    expect(filterTrendPoints(points, "3m", "legacy_report", now)).toHaveLength(1);
  });
  it("ignores a source that is not in the series", () => {
    expect(filterTrendPoints(points, "all", "device", now)).toHaveLength(3);
  });
  it("matches the second source behind a collapsed duplicate", () => {
    const dup = { ...pt("2026-10-01T00:00:00Z", "lab_result"), alsoFrom: "legacy_report" } as TrendPoint;
    expect(filterTrendPoints([dup], "all", "legacy_report", now)).toHaveLength(1);
  });
  it("clamps month-end cutoffs instead of overflowing", () => {
    const aug31 = new Date("2026-08-31T12:00:00Z");
    expect(filterTrendPoints([pt("2026-03-01T00:00:00Z", "lab_result")], "6m", undefined, aug31)).toHaveLength(1);
    expect(filterTrendPoints([pt("2026-02-27T00:00:00Z", "lab_result")], "6m", undefined, aug31)).toHaveLength(0);
  });
  it("excludes a point just outside the window", () => {
    expect(filterTrendPoints([pt("2026-07-28T00:00:00Z", "lab_result")], "3m", undefined, now)).toHaveLength(0);
    expect(filterTrendPoints([pt("2026-07-30T00:00:00Z", "lab_result")], "3m", undefined, now)).toHaveLength(1);
  });
  it("lists only sources present", () => {
    expect(sourcesIn(points)).toEqual(["lab_result", "legacy_report"]);
  });
});
