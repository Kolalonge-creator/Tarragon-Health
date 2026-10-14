/** S67: the kick counter and contraction timer sessions go through the one offline outbox (idempotent by client id). */
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount, listOutbox } from "./outbox";
import type { ContractionSessionPayload, KickSessionPayload } from "./pregnancy-payloads";

const mockInserts: { table: string; row: Record<string, unknown> }[] = [];
let mockInsertError: { code?: string; message?: string } | null = null;
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        mockInserts.push({ table, row });
        return { error: mockInsertError };
      },
    }),
  },
}));

const KICK: KickSessionPayload = {
  started_at: "2026-10-05T08:00:00.000Z", ended_at: "2026-10-05T10:00:00.000Z", movement_offsets_s: [60, 120], reported_less: false,
  result: "contact_today", result_reason: "window_elapsed_without_target", minutes_to_target: null, week_at_start: 31, config_version: 1, organisation_id: "org-1",
};
const CONTRACTION: ContractionSessionPayload = {
  started_at: "2026-10-05T08:00:00.000Z", timings: [{ s: 0, d: 62 }], instant_signs: ["waters_break"], pattern: "standard",
  result: "go_now", result_reason: "instant_sign", week_at_start: 39, config_version: 1, organisation_id: "org-1",
};

beforeEach(() => {
  __resetOutboxForTests();
  mockInserts.length = 0;
  mockInsertError = null;
});

describe("pregnancy sessions in the outbox", () => {
  it("are durable on the phone before any network call and flagged as danger when the card says go", async () => {
    await enqueue({ kind: "kick_session", subjectId: "p1", payload: KICK, danger: true });
    await enqueue({ kind: "contraction_session", subjectId: "p1", payload: CONTRACTION, danger: true });
    expect(mockInserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(2);
    expect((await listOutbox()).every((r) => r.danger)).toBe(true);
  });

  it("flush sends each to its own table with the client id as the idempotency key", async () => {
    const k = await enqueue({ kind: "kick_session", subjectId: "p1", payload: KICK });
    const c = await enqueue({ kind: "contraction_session", subjectId: "p1", payload: CONTRACTION });
    const r = await flushOutbox();
    expect(r.synced).toBe(2);
    expect(mockInserts.map((i) => i.table).sort()).toEqual(["contractions", "kick_counts"]);
    expect(mockInserts.find((i) => i.table === "kick_counts")!.row).toMatchObject({ client_id: k.clientId, patient_id: "p1", result: "contact_today", source: "patient" });
    expect(mockInserts.find((i) => i.table === "contractions")!.row).toMatchObject({ client_id: c.clientId, instant_signs: ["waters_break"] });
  });

  it("a replay after a lost reply (unique violation) is a duplicate, not a second session and not an error", async () => {
    await enqueue({ kind: "kick_session", subjectId: "p1", payload: KICK });
    mockInsertError = { code: "23505", message: "duplicate key value" };
    const r = await flushOutbox();
    expect(r.synced).toBe(1);
    expect(await getPendingCount()).toBe(0);
  });

  it("an outage keeps the row and stops the run (nothing is dropped)", async () => {
    await enqueue({ kind: "contraction_session", subjectId: "p1", payload: CONTRACTION, danger: true });
    mockInsertError = { message: "network request failed" };
    const r = await flushOutbox();
    expect(r.stoppedOffline).toBe(true);
    expect(await getPendingCount()).toBe(1);
  });
});
