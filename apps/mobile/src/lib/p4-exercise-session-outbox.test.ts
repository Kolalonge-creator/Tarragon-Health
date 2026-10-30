/**
 * P4: an exercise session rides the one offline outbox. Durable on the phone before any network call; the client id is the idempotency key; a
 * duplicate is success; a refusal is held for the person; a session that reports a symptom is marked danger.
 */
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount, listOutbox } from "./outbox";
import { logExerciseSession } from "./exercise";

const inserts: Record<string, unknown>[] = [];
let mockInsertError: { code?: string; message: string } | null = null;

jest.mock("./api", () => ({ ...jest.requireActual("./api") }));
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "exercise_session_logs") inserts.push(row);
        return { error: mockInsertError };
      },
    }),
  },
}));

beforeEach(() => {
  __resetOutboxForTests();
  inserts.length = 0;
  mockInsertError = null;
});

const payload = {
  performed_on: "2026-10-29",
  duration_minutes: 25,
  kind: "walking" as const,
  effort: "easy" as const,
  symptom_during: false,
  enrollment_id: null,
  note: null,
};

describe("exercise session in the outbox", () => {
  it("is durable on the phone before any network call", async () => {
    await enqueue({ kind: "exercise_session", subjectId: "user-1", payload });
    expect(inserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
  });

  it("flush sends every field with the client id as the idempotency key", async () => {
    const item = await enqueue({ kind: "exercise_session", subjectId: "user-1", payload: { ...payload, note: "felt good", enrollment_id: "enrol-1" } });
    await flushOutbox();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      organisation_id: "org-1", patient_id: "user-1", enrollment_id: "enrol-1", performed_on: "2026-10-29", duration_minutes: 25,
      kind: "walking", effort: "easy", symptom_during: false, note: "felt good", client_id: item.clientId,
    });
    expect(await getPendingCount()).toBe(0);
  });

  it("a duplicate (23505) counts as done, not a second session", async () => {
    mockInsertError = { code: "23505", message: "duplicate key value violates unique constraint exercise_session_logs_client_id_uidx" };
    await enqueue({ kind: "exercise_session", subjectId: "user-1", payload });
    await flushOutbox();
    expect(await getPendingCount()).toBe(0);
  });

  it("a refusal (the database's date window) is held for the person, never silently dropped", async () => {
    mockInsertError = { code: "22023", message: "Sessions can be logged up to 30 days back." };
    await enqueue({ kind: "exercise_session", subjectId: "user-1", payload });
    await flushOutbox();
    const items = await listOutbox();
    expect(items).toHaveLength(1);
    expect(items[0].state).toBe("rejected");
  });
});

describe("logExerciseSession", () => {
  it("refuses minutes outside 1..600 before queueing anything", async () => {
    for (const minutes of [0, 601, 12.5]) {
      const res = await logExerciseSession("user-1", {
        performedOn: "2026-10-29", minutes, kind: "walking", effort: null, symptomDuring: false, enrollmentId: null, note: "",
      });
      expect(res.error).toBeTruthy();
    }
    expect(await getPendingCount()).toBe(0);
  });

  it("sends at once with signal and reports it is no longer on the phone", async () => {
    const res = await logExerciseSession("user-1", {
      performedOn: "2026-10-29", minutes: 30, kind: "cardio", effort: "hard", symptomDuring: false, enrollmentId: null, note: " ",
    });
    expect(res).toEqual({ stillOnPhone: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ duration_minutes: 30, kind: "cardio", effort: "hard", note: null });
  });

  it("with no signal it stays on the phone and says so", async () => {
    mockInsertError = { message: "Network request failed" };
    const res = await logExerciseSession("user-1", {
      performedOn: "2026-10-29", minutes: 30, kind: "walking", effort: null, symptomDuring: false, enrollmentId: null, note: "",
    });
    expect(res).toEqual({ stillOnPhone: true });
    expect(await getPendingCount()).toBe(1);
  });

  it("marks a session that reports a symptom as danger, so a stuck send is flagged to the person", async () => {
    mockInsertError = { message: "Network request failed" };
    await logExerciseSession("user-1", {
      performedOn: "2026-10-29", minutes: 10, kind: "walking", effort: null, symptomDuring: true, enrollmentId: null, note: "",
    });
    const [item] = await listOutbox();
    expect(item.danger).toBe(true);
  });
});
