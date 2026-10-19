/**
 * A wearable (cuffless) blood pressure estimate is left out in the query itself, so a watch that syncs often can never crowd cuff readings out of
 * the window, and it is read separately for its own labelled line (docs/design/BP-wearable-estimates.md).
 */
import { loadNewestBpEstimate, loadRecentBpReadings } from "./vitals";

const calls: Array<[string, unknown[]]> = [];
let mockData: unknown[] = [];
let mockError: { message: string } | null = null;

jest.mock("./offline-store", () => ({
  pullChangesThrottled: jest.fn(),
  readLocalRecords: jest.fn(async () => [
    { id: "l1", vital_type: "blood_pressure", source: "wearable", systolic: 170, diastolic: 100, taken_at: "2026-10-10T08:00:00Z" },
    { id: "l2", vital_type: "blood_pressure", source: "manual", systolic: 130, diastolic: 82, taken_at: "2026-10-09T08:00:00Z" },
    { id: "l3", vital_type: "blood_pressure", source: "wearable", systolic: 150, diastolic: 95, taken_at: "2026-10-11T08:00:00Z" },
  ]),
}));
jest.mock("./outbox", () => ({ listOutbox: jest.fn(async () => []) }));
jest.mock("./supabase", () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "not", "order", "limit"]) {
        q[m] = (...args: unknown[]) => {
          calls.push([m, args]);
          return q;
        };
      }
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: mockError ? null : mockData, error: mockError }).then(res);
      return q;
    },
  },
}));

beforeEach(() => {
  calls.length = 0;
  mockData = [];
  mockError = null;
});

describe("loadRecentBpReadings", () => {
  it("leaves the estimate out in the query, before the limit", async () => {
    mockData = [{ id: "a", systolic: 128, diastolic: 80, taken_at: "2026-10-10T08:00:00Z", client_reading_id: null, source: "manual" }];
    const out = await loadRecentBpReadings("p1", 10);
    expect(calls).toContainEqual(["neq", ["source", "wearable"]]);
    expect(calls.findIndex(([m]) => m === "neq")).toBeLessThan(calls.findIndex(([m]) => m === "limit"));
    expect(out.map((r) => r.systolic)).toEqual([128]);
  });

  it("offline: the phone's copy drops an estimate too, and keeps a row with no source", async () => {
    mockError = { message: "Network request failed" };
    const out = await loadRecentBpReadings("p1", 10);
    expect(out.map((r) => r.systolic)).toEqual([130]);
  });
});

describe("loadNewestBpEstimate", () => {
  it("reads the newest wearable row only", async () => {
    mockData = [{ systolic: 150, diastolic: 95, taken_at: "2026-10-11T08:00:00Z" }];
    await expect(loadNewestBpEstimate("p1")).resolves.toEqual({ systolic: 150, diastolic: 95, takenAt: "2026-10-11T08:00:00Z" });
    expect(calls).toContainEqual(["eq", ["source", "wearable"]]);
  });

  it("none on the server: null", async () => {
    mockData = [];
    await expect(loadNewestBpEstimate("p1")).resolves.toBeNull();
  });

  it("offline: the newest estimate on the phone", async () => {
    mockError = { message: "Network request failed" };
    await expect(loadNewestBpEstimate("p1")).resolves.toEqual({ systolic: 150, diastolic: 95, takenAt: "2026-10-11T08:00:00Z" });
  });
});
