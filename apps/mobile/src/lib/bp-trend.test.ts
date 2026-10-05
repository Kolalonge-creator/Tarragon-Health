import { BP_THRESHOLDS } from "./bp-classification";
import { buildTrendModel, nearestPointIndex, niceDomain, summariseTrend, windowReadings } from "./bp-trend";
import type { BpReading } from "./vitals";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const reading = (id: string, d: number, systolic: number, diastolic: number, level: BpReading["level"] = "green"): BpReading => ({
  id,
  systolic,
  diastolic,
  takenAt: daysAgo(d),
  level,
});

describe("windowReadings", () => {
  const all = [reading("old", 40, 120, 80), reading("a", 20, 125, 82), reading("b", 3, 130, 84), reading("c", 0.5, 140, 90)];

  it("keeps only readings inside the window, oldest first", () => {
    expect(windowReadings(all, 7, NOW).map((r) => r.id)).toEqual(["b", "c"]);
    expect(windowReadings(all, 30, NOW).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("tolerates a few minutes of clock skew but not a reading from the future", () => {
    const nearFuture = { ...reading("n", 0, 120, 80), takenAt: new Date(NOW + 2 * 60_000).toISOString() };
    const farFuture = { ...reading("f", 0, 120, 80), takenAt: new Date(NOW + 3_600_000).toISOString() };
    expect(windowReadings([nearFuture, farFuture], 7, NOW).map((r) => r.id)).toEqual(["n"]);
  });

  it("drops unparseable dates instead of throwing", () => {
    expect(windowReadings([{ ...reading("x", 1, 120, 80), takenAt: "not a date" }], 7, NOW)).toEqual([]);
  });
});

describe("niceDomain", () => {
  it("rounds outward to multiples of 20 and always covers the reference lines", () => {
    expect(niceDomain(78, 128, 135, 85)).toEqual({ min: 60, max: 140 });
    expect(niceDomain(60, 190, 135, 85)).toEqual({ min: 40, max: 200 });
  });

  it("clamps to a sane range and never collapses", () => {
    const d = niceDomain(10, 400, 135, 85);
    expect(d.min).toBeGreaterThanOrEqual(20);
    expect(d.max).toBeLessThanOrEqual(280);
    expect(niceDomain(100, 100, 100, 100).max - niceDomain(100, 100, 100, 100).min).toBeGreaterThanOrEqual(40);
  });
});

describe("buildTrendModel", () => {
  const readings = [reading("a", 6, 120, 80), reading("b", 3, 150, 95, "red"), reading("c", 0, 130, 84)];
  const model = buildTrendModel(readings, 7, NOW, 320, 200, BP_THRESHOLDS);

  it("places the newest reading at the right edge and the oldest in range", () => {
    expect(model.points[2].x).toBeCloseTo(model.plot.right, 5);
    expect(model.points[0].x).toBeGreaterThan(model.plot.left);
    expect(model.points[0].x).toBeLessThan(model.points[1].x);
  });

  it("higher values sit higher on screen (smaller y) and diastolic is below systolic", () => {
    expect(model.points[1].ySys).toBeLessThan(model.points[0].ySys);
    for (const p of model.points) expect(p.yDia).toBeGreaterThan(p.ySys);
  });

  it("puts the reference lines at the app's own above-target levels", () => {
    const scale = (value: number) =>
      model.plot.bottom - ((value - model.domain.min) / (model.domain.max - model.domain.min)) * (model.plot.bottom - model.plot.top);
    expect(model.refSysY).toBeCloseTo(scale(BP_THRESHOLDS.amber.systolic), 5);
    expect(model.refDiaY).toBeCloseTo(scale(BP_THRESHOLDS.amber.diastolic), 5);
    expect(model.refSysY).toBeLessThan(model.refDiaY);
  });

  it("follows server-synced thresholds, not the bundled ones", () => {
    const synced = buildTrendModel(readings, 7, NOW, 320, 200, { amber: { systolic: 125, diastolic: 80 } });
    expect(synced.refSysY).toBeGreaterThan(model.refSysY);
  });

  it("keeps every point and tick inside the plot area", () => {
    for (const p of model.points) {
      expect(p.x).toBeGreaterThanOrEqual(model.plot.left);
      expect(p.x).toBeLessThanOrEqual(model.plot.right);
      expect(p.ySys).toBeGreaterThanOrEqual(model.plot.top - 0.001);
      expect(p.yDia).toBeLessThanOrEqual(model.plot.bottom + 0.001);
    }
    for (const t of model.yTicks) {
      expect(t.y).toBeGreaterThanOrEqual(model.plot.top - 0.001);
      expect(t.y).toBeLessThanOrEqual(model.plot.bottom + 0.001);
    }
  });

  it("handles an empty window", () => {
    const empty = buildTrendModel([], 30, NOW, 320, 200, BP_THRESHOLDS);
    expect(empty.points).toEqual([]);
    expect(empty.yTicks.length).toBeGreaterThan(1);
  });
});

describe("nearestPointIndex", () => {
  const pts = [{ x: 10 }, { x: 100 }, { x: 250 }];
  it("finds the closest point to a touch", () => {
    expect(nearestPointIndex(pts, 0)).toBe(0);
    expect(nearestPointIndex(pts, 60)).toBe(1);
    expect(nearestPointIndex(pts, 300)).toBe(2);
  });
  it("returns -1 when there is nothing to pick", () => {
    expect(nearestPointIndex([], 50)).toBe(-1);
  });
});

describe("summariseTrend", () => {
  it("is null for an empty window", () => {
    expect(summariseTrend([])).toBeNull();
  });

  it("describes without judging: range, average, latest, and how many sat above target", () => {
    const s = summariseTrend([reading("a", 6, 120, 80), reading("b", 3, 150, 95, "red"), reading("c", 0, 130, 84, "amber")])!;
    expect(s).toMatchObject({ count: 3, minSystolic: 120, maxSystolic: 150, minDiastolic: 80, maxDiastolic: 95, avgSystolic: 133, avgDiastolic: 86, aboveTargetCount: 2 });
    expect(s.latest.id).toBe("c");
  });
});
