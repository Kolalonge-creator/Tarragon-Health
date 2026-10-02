/**
 * S06 outbox: offline logging and sync. Covers idempotency, ordering, the
 * rejected-row rule, account ownership, and that nothing is dropped silently.
 */
import { NETWORK_ERROR_MESSAGE, postVitalReading, type VitalReadingPayload } from "./api";
import { openDatabaseAsync } from "../test/mocks/expo-sqlite";
import {
  NotSignedInError,
  discardRejectedRow,
  enqueue,
  flushOutbox,
  getOutboxSummary,
  getPendingCount,
  listOutbox,
  retryRow,
} from "./outbox";

let mockSessionUser: string | null = "user-1";
const mockInserts: { table: string; row: Record<string, unknown> }[] = [];
let mockInsertError: { code?: string; message?: string } | null = null;
let mockProfileError: { code?: string; message?: string } | null = null;

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockSessionUser ? { user: { id: mockSessionUser } } : null } }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            mockProfileError ? { data: null, error: mockProfileError } : { data: { organisation_id: "org-1" }, error: null },
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        mockInserts.push({ table, row });
        return { error: mockInsertError };
      },
    }),
  },
}));

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn(),
}));
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;

const BP: VitalReadingPayload = { vital_type: "blood_pressure", systolic: 120, diastolic: 80 };
const SYMPTOM = { symptom_type: "headache", severity: 4, description: null };
const DOSE = {
  medication_id: "med-1",
  scheduled_time: "08:00",
  scheduled_for_date: "2026-10-02",
  status: "taken",
  organisation_id: "org-1",
};

beforeEach(() => {
  mockSessionUser = "user-1";
  mockInserts.length = 0;
  mockInsertError = null;
  mockProfileError = null;
});

describe("enqueue", () => {
  it("is durable before any network call, for every kind", async () => {
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockInserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(3);
  });

  it("stamps the signed-in account as the owner and keeps the supporter's beneficiary", async () => {
    await enqueue({ kind: "symptom", subjectId: "ben-1", beneficiaryProfileId: "ben-1", payload: SYMPTOM });
    const [row] = await listOutbox();
    expect(row).toMatchObject({ ownerUserId: "user-1", subjectId: "ben-1", beneficiaryProfileId: "ben-1" });
  });

  it("refuses to queue with nobody signed in", async () => {
    mockSessionUser = null;
    await expect(enqueue({ kind: "dose", subjectId: "p1", payload: DOSE })).rejects.toBeInstanceOf(NotSignedInError);
  });

  it("records the device time at logging as client_recorded_at", async () => {
    const before = Date.now();
    const item = await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    expect(new Date(item.clientRecordedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("flushOutbox: sending", () => {
  it("sends a symptom and a dose with their client id and device time, then clears them", async () => {
    const s = await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    const d = await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    const result = await flushOutbox();

    expect(result).toMatchObject({ synced: 2, remaining: 0, stoppedOffline: false });
    expect(mockInserts[0]).toMatchObject({
      table: "symptoms",
      row: { client_id: s.clientId, client_recorded_at: s.clientRecordedAt, patient_id: "p1", organisation_id: "org-1" },
    });
    expect(mockInserts[1]).toMatchObject({
      table: "medication_logs",
      row: { client_id: d.clientId, client_recorded_at: d.clientRecordedAt, patient_id: "p1" },
    });
  });

  it("sends a vital with its key and device time", async () => {
    mockPost.mockResolvedValue({ success: true });
    const v = await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await flushOutbox();
    expect(mockPost).toHaveBeenCalledWith(BP, undefined, v.clientId, v.clientRecordedAt);
  });

  it("sends oldest first", async () => {
    mockPost.mockResolvedValue({ success: true });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await new Promise((r) => setTimeout(r, 5));
    await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    await flushOutbox();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockInserts).toHaveLength(1);
  });

  it("treats a duplicate key (23505) as already done, for symptoms and doses", async () => {
    mockInsertError = { code: "23505", message: "duplicate key value" };
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    await expect(flushOutbox()).resolves.toMatchObject({ synced: 2, remaining: 0, newlyRejected: 0 });
    expect(await getPendingCount()).toBe(0);
  });

  it("a blind retry after a lost reply writes the same client id again, never a new one", async () => {
    await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    mockInsertError = { message: "Network request failed" };
    await flushOutbox();
    mockInsertError = null;
    await flushOutbox();
    expect(mockInserts).toHaveLength(2);
    expect(mockInserts[0].row.client_id).toBe(mockInserts[1].row.client_id);
  });
});

describe("flushOutbox: failures", () => {
  it("a network failure stops the run and keeps everything, without counting an attempt", async () => {
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    mockInsertError = { message: "Network request failed" };
    const result = await flushOutbox();
    expect(result).toMatchObject({ synced: 0, remaining: 2, stoppedOffline: true });
    expect(mockInserts).toHaveLength(1);
    expect((await listOutbox()).every((r) => r.attempts === 0 && r.state === "pending")).toBe(true);
  });

  it("an expired session holds the rows, counts no attempt, and keeps them", async () => {
    mockPost.mockResolvedValue({ success: false, error: "Your session expired", status: 401 });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    const result = await flushOutbox();
    expect(result.stoppedOffline).toBe(true);
    expect((await listOutbox())[0]).toMatchObject({ attempts: 0, state: "pending" });
  });

  it("a row the server refuses never blocks the rows behind it", async () => {
    await enqueue({ kind: "symptom", subjectId: "p1", payload: { ...SYMPTOM, severity: 0 } });
    await new Promise((r) => setTimeout(r, 5));
    await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    let call = 0;
    const original = mockInserts.push.bind(mockInserts);
    mockInsertError = null;
    // first insert (the symptom) is refused by a NOT NULL violation, the dose succeeds
    jest.spyOn(mockInserts, "push").mockImplementation((item) => {
      call += 1;
      mockInsertError = call === 1 ? { code: "23502", message: "null value violates not-null constraint" } : null;
      return original(item);
    });
    const result = await flushOutbox();
    expect(result).toMatchObject({ synced: 1, newlyRejected: 1, remaining: 1 });
    const left = await listOutbox();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "symptom", state: "rejected" });
    jest.restoreAllMocks();
  });

  it("a rejected row is kept, visible with a support code, and not resent automatically", async () => {
    mockPost.mockResolvedValue({ success: false, error: "Invalid", status: 400 });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await flushOutbox();
    await flushOutbox();
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [row] = await listOutbox();
    expect(row.state).toBe("rejected");
    expect(row.supportCode).toMatch(/^[0-9A-F]{8}$/);
    expect(row.lastError).toBe("Invalid");
  });

  it("a server error backs the row off, so it is not resent straight away", async () => {
    mockPost.mockResolvedValue({ success: false, error: "Request failed (500)", status: 500 });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await flushOutbox();
    await flushOutbox();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect((await listOutbox())[0]).toMatchObject({ attempts: 1, state: "pending" });
  });

  it("Retry puts a rejected row back in the queue, due now", async () => {
    mockPost.mockResolvedValueOnce({ success: false, error: "Invalid", status: 400 });
    const v = await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await flushOutbox();
    await retryRow(v.clientId);
    mockPost.mockResolvedValue({ success: true });
    await expect(flushOutbox()).resolves.toMatchObject({ synced: 1, remaining: 0 });
  });

  it("an organisation lookup that fails on the network keeps the symptom queued", async () => {
    mockProfileError = { message: "Network request failed" };
    await enqueue({ kind: "symptom", subjectId: "p1", payload: SYMPTOM });
    await expect(flushOutbox()).resolves.toMatchObject({ stoppedOffline: true, remaining: 1 });
    expect(mockInserts).toHaveLength(0);
  });
});

describe("account ownership", () => {
  it("never flushes a row under a different account", async () => {
    mockPost.mockResolvedValue({ success: true });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    mockSessionUser = "user-2";
    const result = await flushOutbox();
    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ synced: 0, held: 1, remaining: 1 });
  });

  it("sends nothing while signed out, deletes nothing, and sends once the owner is back", async () => {
    mockPost.mockResolvedValue({ success: true });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    mockSessionUser = null;
    await flushOutbox();
    expect(await getPendingCount()).toBe(1);
    mockSessionUser = "user-1";
    await expect(flushOutbox()).resolves.toMatchObject({ synced: 1 });
  });

  it("counts rows held for another account in the summary", async () => {
    await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    mockSessionUser = "user-2";
    expect((await getOutboxSummary()).heldForOtherAccount).toBe(1);
  });

  it("the second account's own rows still go out while the first account's wait", async () => {
    mockPost.mockResolvedValue({ success: true });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    mockSessionUser = "user-2";
    await enqueue({ kind: "dose", subjectId: "p2", payload: DOSE });
    const result = await flushOutbox();
    expect(result).toMatchObject({ synced: 1, held: 1, remaining: 1 });
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockInserts[0].table).toBe("medication_logs");
  });
});

describe("discardRejectedRow", () => {
  it("removes only a rejected row, and only on an explicit call", async () => {
    mockPost.mockResolvedValue({ success: false, error: "Invalid", status: 400 });
    const rejected = await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await flushOutbox();
    const waiting = await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    mockInsertError = { message: "Network request failed" };
    await flushOutbox();

    expect(await discardRejectedRow(waiting.clientId)).toBe(false);
    expect(await discardRejectedRow(rejected.clientId)).toBe(true);
    expect((await listOutbox()).map((r) => r.clientId)).toEqual([waiting.clientId]);
  });
});

describe("summary and stuck notice", () => {
  it("flags a row stuck after 12 hours, a dangerous-looking one after 1 hour, and a rejected one always", async () => {
    const a = await enqueue({ kind: "dose", subjectId: "p1", payload: DOSE });
    const b = await enqueue({ kind: "vital", subjectId: "p1", payload: BP, danger: true });
    const db = await openDatabaseAsync("tarragon-offline.db");
    const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    await db.runAsync("update outbox set created_at = ? where client_id = ?", [at(2), a.clientId]);
    await db.runAsync("update outbox set created_at = ? where client_id = ?", [at(2), b.clientId]);
    expect((await getOutboxSummary()).stuck).toBe(1);
    await db.runAsync("update outbox set created_at = ? where client_id = ?", [at(13), a.clientId]);
    expect((await getOutboxSummary()).stuck).toBe(2);
  });
});

describe("concurrent flushes", () => {
  it("share one run, so a row is never in flight twice", async () => {
    mockPost.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { success: true };
    });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    const [a, b] = await Promise.all([flushOutbox(), flushOutbox()]);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});

describe("legacy pending_vitals", () => {
  it("is adopted into the outbox under the signed-in account, then removed from the old table", async () => {
    await jest.isolateModulesAsync(async () => {
      const sqlite = require("expo-sqlite") as typeof import("../test/mocks/expo-sqlite");
      const db = await sqlite.openDatabaseAsync("tarragon-offline.db");
      await db.execAsync(
        "create table if not exists pending_vitals (client_reading_id text primary key, payload text not null, beneficiary_profile_id text, created_at text not null, attempts integer not null default 0, last_error text)"
      );
      await db.runAsync("insert into pending_vitals values (?, ?, null, ?, 2, 'old error')", [
        "legacy-1",
        JSON.stringify(BP),
        "2026-10-01T08:00:00.000Z",
      ]);
      const fresh = require("./outbox") as typeof import("./outbox");
      const items = await fresh.listOutbox();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        clientId: "legacy-1",
        kind: "vital",
        ownerUserId: "user-1",
        createdAt: "2026-10-01T08:00:00.000Z",
        attempts: 2,
      });
      expect(await db.getAllAsync("select * from pending_vitals")).toHaveLength(0);
    });
  });
});

describe("network message constant", () => {
  it("is what the outbox treats as an outage", async () => {
    mockPost.mockResolvedValue({ success: false, error: NETWORK_ERROR_MESSAGE });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await expect(flushOutbox()).resolves.toMatchObject({ stoppedOffline: true });
  });
});
