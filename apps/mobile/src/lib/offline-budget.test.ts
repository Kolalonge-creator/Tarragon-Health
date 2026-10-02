/**
 * Performance budget for the offline store, held against the Jest SQLite
 * stand-in (Node's real SQLite engine). READ THIS BEFORE QUOTING A RESULT:
 *
 *   MEASURED here (on a developer laptop, so only an order-of-magnitude guard):
 *     enqueue latency, pull upsert time, outbox database growth, bytes per day.
 *   NOT MEASURED on a device (no 2 GB Android phone exists in this project yet):
 *     cold start under 3 s, installed size under 40 MB, real memory use,
 *     expo-sqlite's own speed on a low-end phone.
 *   A pass below is therefore never evidence that a 2 GB Android phone meets
 *   the spec D.1 targets. Those three stay open until a device lab run.
 */
import { openDatabaseAsync } from "../test/mocks/expo-sqlite";
import { OFFLINE_BUDGET } from "./offline-budget";
import { enqueue } from "./outbox";
import { clearLocalMirror, pullChanges } from "./offline-store";

type Row = { id: string; created_at: string; patient_id: string; [k: string]: unknown };
const mockTables: Record<string, Row[]> = { vitals_readings: [], symptoms: [], medication_logs: [], medications: [] };

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => {
      let after: string | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        or: (v: string) => ((after = /id\.gt\.(.+?)\)/.exec(v)![1]), q),
        order: () => q,
        limit: (n: number) => {
          q.n = n;
          return q;
        },
        then: (res: (v: unknown) => unknown) => {
          let rows = mockTables[table] ?? [];
          if (after) rows = rows.filter((r) => r.id > after!);
          return Promise.resolve({ data: rows.slice(0, (q.n as number) ?? rows.length), error: null }).then(res);
        },
      };
      return q;
    },
  },
}));

const BP = { vital_type: "blood_pressure", systolic: 128, diastolic: 82 } as const;

describe("offline budget (Jest stand-in, not a device)", () => {
  it(`enqueue stays under ${OFFLINE_BUDGET.enqueueMsMax} ms even with 1000 rows already waiting`, async () => {
    for (let i = 0; i < 1000; i++) await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    const start = performance.now();
    await enqueue({ kind: "vital", subjectId: "p1", payload: BP });
    expect(performance.now() - start).toBeLessThan(OFFLINE_BUDGET.enqueueMsMax);
  });

  it(`1000 queued rows take under ${OFFLINE_BUDGET.outboxDbBytesPer1000Rows} bytes of database`, async () => {
    const db = await openDatabaseAsync("tarragon-offline.db");
    const pages = await db.getFirstAsync<{ page_count: number }>("pragma page_count");
    const size = await db.getFirstAsync<{ page_size: number }>("pragma page_size");
    const rows = await db.getFirstAsync<{ n: number }>("select count(*) as n from outbox");
    const bytes = (pages!.page_count * size!.page_size * 1000) / Math.max(rows!.n, 1000);
    expect(bytes).toBeLessThan(OFFLINE_BUDGET.outboxDbBytesPer1000Rows);
  });

  it(`pulling a page-capped 1000 rows takes under ${OFFLINE_BUDGET.pullUpsertMsPer1000Rows} ms`, async () => {
    await clearLocalMirror();
    mockTables.vitals_readings = Array.from({ length: 1000 }, (_, i) => ({
      id: `v-${String(i).padStart(5, "0")}`,
      created_at: new Date(Date.now() - (1000 - i) * 1000).toISOString(),
      patient_id: "p1",
      vital_type: "weight",
      weight_kg: 70,
    }));
    const start = performance.now();
    const result = await pullChanges("p1");
    expect(performance.now() - start).toBeLessThan(OFFLINE_BUDGET.pullUpsertMsPer1000Rows);
    expect(result.pages).toBeLessThanOrEqual(OFFLINE_BUDGET.maxPagesPerPull);
  });

  it("a day of typical use stays far under the 1 MB data budget (payload bytes only)", async () => {
    // 3 vitals, 4 dose logs, 2 symptoms posted, plus a pull of the same 9 rows back.
    const posted = 3 * JSON.stringify({ ...BP, taken_at: new Date().toISOString(), client_reading_id: "x".repeat(36) }).length +
      6 * JSON.stringify({ medication_id: "x".repeat(36), status: "taken", client_id: "x".repeat(36), client_recorded_at: new Date().toISOString() }).length;
    await clearLocalMirror();
    mockTables.vitals_readings = [];
    mockTables.symptoms = Array.from({ length: 9 }, (_, i) => ({
      id: `s-${i}`,
      created_at: new Date().toISOString(),
      patient_id: "p1",
      symptom_type: "headache",
      severity: 4,
    }));
    const pulled = (await pullChanges("p1")).bytes;
    expect(posted + pulled).toBeLessThan(OFFLINE_BUDGET.dailyBytesMax / 10);
  });
});
