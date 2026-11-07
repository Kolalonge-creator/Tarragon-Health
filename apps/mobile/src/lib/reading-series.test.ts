/**
 * The 30-day series behind the phone's big-number tiles follows the "latest reading" rules: no corrected readings, no wearable
 * estimate for blood pressure or pulse, and a failed read reported as failed (never an empty chart).
 */
import { loadPinSeries } from "./reading-series";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));
const mockFrom = supabase.from as unknown as jest.Mock;

type Call = { method: string; args: unknown[] };

function query(result: { data?: unknown; error?: { message: string } | null }, calls: Call[] = []) {
  const settled = Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "not", "is", "order"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.limit = (...args: unknown[]) => {
    calls.push({ method: "limit", args });
    return settled;
  };
  return builder;
}

const NOW = Date.parse("2026-11-06T12:00:00Z");
beforeEach(() => mockFrom.mockReset());

it("skips corrected readings and wearable estimates for blood pressure, charting the top number", async () => {
  const calls: Call[] = [];
  mockFrom.mockReturnValue(query({ data: [] }, calls));
  await loadPinSeries("p1", ["bp"], NOW);
  expect(mockFrom).toHaveBeenCalledWith("vitals_readings");
  expect(calls).toContainEqual({ method: "is", args: ["correction_status", null] });
  expect(calls).toContainEqual({ method: "neq", args: ["source", "wearable"] });
  expect(calls).toContainEqual({ method: "eq", args: ["vital_type", "blood_pressure"] });
  expect(calls).toContainEqual({ method: "select", args: ["taken_at, systolic"] });
});

it("keeps wearable weight but not wearable pulse", async () => {
  const w: Call[] = [];
  mockFrom.mockReturnValue(query({ data: [] }, w));
  await loadPinSeries("p1", ["weight"], NOW);
  expect(w.some((c) => c.method === "neq")).toBe(false);
  const p: Call[] = [];
  mockFrom.mockReturnValue(query({ data: [] }, p));
  await loadPinSeries("p1", ["pulse"], NOW);
  expect(p).toContainEqual({ method: "neq", args: ["source", "wearable"] });
});

it("reports a failed read (an error or a thrown request) as failed", async () => {
  mockFrom.mockReturnValue(query({ error: { message: "boom" } }));
  expect(await loadPinSeries("p1", ["weight"], NOW)).toEqual({ weight: "failed" });
  mockFrom.mockImplementation(() => {
    throw new Error("offline");
  });
  expect(await loadPinSeries("p1", ["glucose"], NOW)).toEqual({ glucose: "failed" });
});

it("reads nothing for pins with no series, and parses rows newest first", async () => {
  expect(await loadPinSeries("p1", ["active_meds", "doses_today"], NOW)).toEqual({});
  expect(mockFrom).not.toHaveBeenCalled();
  mockFrom.mockReturnValue(query({ data: [{ taken_at: "2026-11-05T08:00:00Z", weight_kg: 74 }, { taken_at: "2026-10-20T08:00:00Z", weight_kg: 75 }] }));
  const s = (await loadPinSeries("p1", ["weight"], NOW)).weight;
  expect(s).toEqual({ latestAt: Date.parse("2026-11-05T08:00:00Z"), latestValue: 74, points: [{ t: Date.parse("2026-10-20T08:00:00Z"), v: 75 }, { t: Date.parse("2026-11-05T08:00:00Z"), v: 74 }] });
});
