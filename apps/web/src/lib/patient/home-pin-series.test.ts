/**
 * The 30-day series behind the big-number tiles follows the "latest reading" rules: no corrected readings, no wearable
 * estimate for blood pressure or pulse, a failed read reported as failed, and the latest reading kept even when older than
 * the chart window.
 */
const calls: unknown[][] = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "neq", "order"]) b[m] = (...a: unknown[]) => (calls.push([m, ...a]), b);
      b.limit = async () => result;
      return b;
    },
  }),
}));

import { getPinSeries } from "./home-pin-series";

const NOW = Date.parse("2026-11-06T12:00:00Z");
beforeEach(() => (calls.length = 0));

it("skips corrected readings and wearable estimates for blood pressure", async () => {
  await getPinSeries("p1", ["bp"], NOW);
  expect(calls).toContainEqual(["is", "correction_status", null]);
  expect(calls).toContainEqual(["neq", "source", "wearable"]);
  expect(calls).toContainEqual(["eq", "vital_type", "blood_pressure"]);
});

it("keeps wearable weight but not wearable pulse", async () => {
  await getPinSeries("p1", ["weight"], NOW);
  expect(calls.some((c) => c[0] === "neq")).toBe(false);
  calls.length = 0;
  await getPinSeries("p1", ["pulse"], NOW);
  expect(calls).toContainEqual(["neq", "source", "wearable"]);
});

it("reports a failed read as failed", async () => {
  result = { data: null, error: { message: "boom" } };
  expect(await getPinSeries("p1", ["weight"], NOW)).toEqual({ weight: "failed" });
});

it("keeps the latest reading even when it is older than 30 days, and charts only the last 30", async () => {
  result = {
    data: [
      { taken_at: "2026-11-05T08:00:00Z", weight_kg: 74 },
      { taken_at: "2026-10-20T08:00:00Z", weight_kg: 75 },
      { taken_at: "2026-08-01T08:00:00Z", weight_kg: 78 },
    ],
    error: null,
  };
  const s = (await getPinSeries("p1", ["weight"], NOW)).weight;
  expect(s).not.toBe("failed");
  if (s && s !== "failed") {
    expect(s.latestValue).toBe(74);
    expect(s.points.map((p) => p.v)).toEqual([75, 74]);
  }
  result = { data: [{ taken_at: "2026-08-01T08:00:00Z", weight_kg: 78 }], error: null };
  const old = (await getPinSeries("p1", ["weight"], NOW)).weight;
  if (old && old !== "failed") {
    expect(old.latestValue).toBe(78);
    expect(old.points).toEqual([]);
  }
});
