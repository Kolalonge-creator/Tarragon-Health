/**
 * The patient-facing behaviour of S06: log with no signal and still see it,
 * read the last copy with no signal, and never show a failed read as "none".
 */
import { logDose, loadTodaysDoses, todayIsoDate } from "./medications";
import { logSymptom, loadSymptomHistory } from "./symptoms";
import { enqueue, getPendingCount, flushOutbox } from "./outbox";
import { loadRecentBpReadings } from "./vitals";
import { clearLocalMirror, pullChanges } from "./offline-store";

type Row = Record<string, unknown> & { id?: string; created_at?: string; patient_id?: string };
const mockTables: Record<string, Row[]> = {};
let mockOnline = true;
let mockInsertError: { code?: string; message?: string } | null = null;
const mockInserted: { table: string; row: Row }[] = [];

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        in: () => q,
        gte: () => q,
        or: () => q,
        order: () => q,
        limit: () => q,
        single: async () =>
          mockOnline ? { data: { organisation_id: "org-1" }, error: null } : { data: null, error: { message: "Network request failed" } },
        insert: async (row: Row) => {
          if (!mockOnline) return { error: { message: "Network request failed" } };
          mockInserted.push({ table, row });
          return { error: mockInsertError };
        },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(
            mockOnline ? { data: mockTables[table] ?? [], error: null } : { data: null, error: { message: "Network request failed" } }
          ).then(res),
      };
      return q;
    },
  },
}));

const item = { medicationId: "m1", drugName: "Amlodipine", time: "08:00", status: "pending" as const };

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.medications = [{ id: "m1", drug_name: "Amlodipine", schedule_times: ["08:00"], patient_id: "p1", is_active: true }];
  mockTables.medication_logs_latest_per_slot = [];
  mockTables.medication_logs = [];
  mockTables.symptoms = [];
  mockOnline = true;
  mockInsertError = null;
  mockInserted.length = 0;
  await clearLocalMirror();
});

describe("logging a dose", () => {
  it("online: sent at once, nothing left on the phone", async () => {
    await expect(logDose("p1", "org-1", item, "taken")).resolves.toMatchObject({ synced: true });
    expect(mockInserted[0]).toMatchObject({ table: "medication_logs", row: { status: "taken", patient_id: "p1" } });
    expect(await getPendingCount()).toBe(0);
  });

  it("offline: saved with no error, shown as taken, and sent later with the same id", async () => {
    await pullChanges("p1"); // a copy of the medication list from an earlier online session
    mockOnline = false;
    const result = await logDose("p1", "org-1", item, "taken");
    expect(result).toMatchObject({ synced: false });
    expect(result.error).toBeUndefined();
    expect(await getPendingCount()).toBe(1);

    const doses = await loadTodaysDoses("p1");
    expect(doses).toEqual({ ok: true, data: [expect.objectContaining({ medicationId: "m1", status: "taken" })] });

    mockOnline = true;
    await flushOutbox();
    expect(mockInserted).toHaveLength(1);
    expect(await getPendingCount()).toBe(0);
  });

  it("a second tap on the same slot offline wins over the first in the checklist", async () => {
    await pullChanges("p1");
    mockOnline = false;
    await logDose("p1", "org-1", item, "taken");
    await new Promise((r) => setTimeout(r, 5));
    await logDose("p1", "org-1", item, "missed");
    const doses = await loadTodaysDoses("p1");
    expect(doses.ok && doses.data[0].status).toBe("missed");
  });
});

describe("reading with no signal", () => {
  it("never shows a failed read as an empty list when there is no copy on the phone", async () => {
    mockOnline = false;
    const doses = await loadTodaysDoses("p1");
    expect(doses.ok).toBe(false);
    const symptoms = await loadSymptomHistory("p1");
    expect(symptoms.ok).toBe(false);
  });

  it("shows the last copy pulled while online", async () => {
    mockTables.symptoms = [
      { id: "s1", created_at: new Date().toISOString(), reported_at: new Date().toISOString(), patient_id: "p1", symptom_type: "headache", severity: 3 },
    ];
    await pullChanges("p1");
    mockOnline = false;
    const symptoms = await loadSymptomHistory("p1");
    expect(symptoms.ok && symptoms.data).toHaveLength(1);
  });
});

describe("logging a symptom", () => {
  it("offline: saved on the phone, reported as not yet synced, no error", async () => {
    mockOnline = false;
    await expect(logSymptom("p1", { symptomType: "headache" as never, severity: 4 })).resolves.toMatchObject({
      success: true,
      synced: false,
    });
    expect(await getPendingCount()).toBe(1);
  });

  it("a refused symptom is kept, never dropped, and is not reported as synced", async () => {
    mockInsertError = { code: "23502", message: "null value in column severity" };
    const result = await logSymptom("p1", { symptomType: "headache" as never, severity: 4 });
    expect(result).toMatchObject({ success: true, synced: false });
    expect(result.rejectedSupportCode).toMatch(/^[0-9A-F]{8}$/);
    expect(await getPendingCount()).toBe(1);
  });

  it("the date used for a dose is the Lagos calendar date at logging, not at sync", async () => {
    mockOnline = false;
    await logDose("p1", "org-1", item, "taken");
    mockOnline = true;
    await flushOutbox();
    expect(mockInserted[0].row.scheduled_for_date).toBe(todayIsoDate());
  });
});

describe("recent blood pressure readings with unsent readings on the phone", () => {
  const BP = { vital_type: "blood_pressure", systolic: 126, diastolic: 84 } as const;

  it("shows a reading logged offline straight away, marked pending, at the top", async () => {
    mockTables.vitals_readings = [
      { id: "v1", systolic: 120, diastolic: 80, taken_at: new Date(Date.now() - 3_600_000).toISOString(), vital_type: "blood_pressure", patient_id: "p1" },
    ];
    mockOnline = false;
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    const list = await loadRecentBpReadings("p1");
    expect(list[0]).toMatchObject({ systolic: 126, diastolic: 84, pending: true });
  });

  it("shows it online too while it waits, and not another subject's reading", async () => {
    await enqueue({ kind: "vital", subjectId: "p2", payload: BP });
    const list = await loadRecentBpReadings("p1");
    expect(list.some((r) => r.pending)).toBe(false);
  });

  it("drops the pending marker once it has been sent", async () => {
    mockTables.vitals_readings = [];
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    expect((await loadRecentBpReadings("p1")).some((r) => r.pending)).toBe(true);
    await flushOutbox();
    expect((await loadRecentBpReadings("p1")).some((r) => r.pending)).toBe(false);
  });

  it("does not label a rejected reading as waiting", async () => {
    const { postVitalReading } = jest.requireMock("./api") as { postVitalReading: jest.Mock };
    postVitalReading.mockResolvedValueOnce({ success: false, error: "Invalid", status: 400 });
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    await flushOutbox();
    expect((await loadRecentBpReadings("p1")).some((r) => r.pending)).toBe(false);
  });

  it("does not show a reading twice when the server already has it but the row has not been removed yet", async () => {
    const queued = await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    mockTables.vitals_readings = [
      { id: "srv1", systolic: 126, diastolic: 84, taken_at: new Date().toISOString(), vital_type: "blood_pressure", patient_id: "p1", client_reading_id: queued.clientId },
    ];
    const list = await loadRecentBpReadings("p1");
    expect(list.filter((r) => r.systolic === 126)).toHaveLength(1);
    expect(list[0].pending).toBeUndefined();
  });
});
