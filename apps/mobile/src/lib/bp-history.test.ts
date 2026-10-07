import { askForCorrection, loadBpHistory } from "./bp-history";
import { readingReference } from "./bp-history-model";

type Result = { data: unknown; error: { message: string } | null } | "throw";
const mockTables: Record<string, Result> = {};
const mockQueried: string[] = [];
let mockOutbox: unknown[] = [];
let mockLocal: unknown[] = [];
const mockInserts: unknown[] = [];
let mockInsertFails = false;

jest.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => {
      mockQueried.push(table);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) q[m] = () => q;
      q.limit = async () => {
        const r = mockTables[table] ?? { data: [], error: null };
        if (r === "throw") throw new Error("Network request failed");
        return r;
      };
      q.insert = async (row: unknown) => {
        mockInserts.push(row);
        return { error: mockInsertFails ? { message: "no" } : null };
      };
      return q;
    },
  },
}));
jest.mock("./outbox", () => ({ listOutbox: async () => mockOutbox }));
jest.mock("./offline-store", () => ({ readLocalRecords: async () => mockLocal }));

const ID = "11111111-1111-4111-8111-111111111111";
const ROW = { id: ID, systolic: 130, diastolic: 80, taken_at: "2026-10-04T07:00:00Z", source: "manual", client_reading_id: null };

beforeEach(() => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockQueried.length = 0;
  mockInserts.length = 0;
  mockOutbox = [];
  mockLocal = [];
  mockInsertFails = false;
  mockTables.vitals_readings = { data: [ROW], error: null };
});

describe("loadBpHistory", () => {
  it("loads readings and requests for her own record and allows asking", async () => {
    const out = await loadBpHistory("u1", "u1");
    expect(out).toMatchObject({ canRequest: true, failed: false });
    expect(out.readings).toHaveLength(1);
    expect(mockQueried).toContain("data_correction_requests");
  });

  it("does not read requests, and cannot ask, while acting for someone else", async () => {
    const out = await loadBpHistory("p9", "u1");
    expect(out.canRequest).toBe(false);
    expect(mockQueried).not.toContain("data_correction_requests");
    expect(out.readings).toHaveLength(1);
  });

  it("keeps the readings but turns asking off when requests cannot be read", async () => {
    mockTables.data_correction_requests = "throw";
    const out = await loadBpHistory("u1", "u1");
    expect(out.canRequest).toBe(false);
    expect(out.readings).toHaveLength(1);
  });

  it("says it failed, not 'no readings', when the server cannot be read and nothing is saved on the phone", async () => {
    mockTables.vitals_readings = "throw";
    expect((await loadBpHistory("u1", "u1")).failed).toBe(true);
  });

  it("uses the copy on the phone when the server cannot be read", async () => {
    mockTables.vitals_readings = "throw";
    mockLocal = [{ ...ROW, vital_type: "blood_pressure" }, { ...ROW, id: "x", vital_type: "glucose" }];
    const out = await loadBpHistory("u1", "u1");
    expect(out.failed).toBe(false);
    expect(out.readings.map((r) => r.id)).toEqual([ID]);
  });

  it("shows a reading that is only on the phone, and is not 'failed' because of it", async () => {
    mockTables.vitals_readings = "throw";
    mockOutbox = [
      { clientId: "c1", state: "pending", subjectId: "u1", payload: { vital_type: "blood_pressure", systolic: 120, diastolic: 70 }, clientRecordedAt: "2026-10-04T08:00:00Z", supportCode: "AB" },
      { clientId: "c2", state: "pending", subjectId: "someone-else", payload: { vital_type: "blood_pressure", systolic: 99, diastolic: 60 }, clientRecordedAt: "2026-10-04T08:00:00Z", supportCode: "CD" },
      { clientId: "c3", state: "pending", subjectId: "u1", payload: { vital_type: "glucose" }, clientRecordedAt: "2026-10-04T08:00:00Z", supportCode: "EF" },
    ];
    const out = await loadBpHistory("u1", "u1");
    expect(out.failed).toBe(false);
    expect(out.readings.map((r) => [r.id, r.syncState])).toEqual([["c1", "on_phone"]]);
  });
});

describe("askForCorrection", () => {
  const reading = { id: ID, systolic: 152, diastolic: 96, takenAt: "2026-10-04T13:05:00Z" };

  it("files the request under the caller with the reading reference in the description", async () => {
    const res = await askForCorrection("org1", "u1", reading, "  I typed the wrong number  ", " 125/78 ");
    expect(res).toEqual({ ok: true });
    expect(mockInserts[0]).toMatchObject({
      organisation_id: "org1",
      patient_id: "u1",
      what_is_wrong: "I typed the wrong number",
      requested_change: "125/78",
    });
    expect((mockInserts[0] as { record_description: string }).record_description).toContain(readingReference(ID));
    expect((mockInserts[0] as { record_description: string }).record_description).toContain("152/96 mmHg, 2026-10-04 14:05 (Lagos)");
  });

  it("sends nothing for an empty reason", async () => {
    expect(await askForCorrection("org1", "u1", reading, "   ")).toEqual({ ok: false, reason: "empty" });
    expect(mockInserts).toHaveLength(0);
  });

  it("reports a failure rather than pretending it went", async () => {
    mockInsertFails = true;
    expect(await askForCorrection("org1", "u1", reading, "wrong")).toEqual({ ok: false, reason: "failed" });
  });

  it("leaves the optional change out when blank and caps long text", async () => {
    await askForCorrection("org1", "u1", reading, "x".repeat(3000), "   ");
    const row = mockInserts[0] as { what_is_wrong: string; requested_change: string | null };
    expect(row.what_is_wrong).toHaveLength(1000);
    expect(row.requested_change).toBeNull();
  });
});
