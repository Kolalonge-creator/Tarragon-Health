/**
 * D.1: a wellbeing check-in rides the one offline outbox. Durable on the phone before any network call; the check-in time is the
 * idempotency key (the table has no client id column), so a retry after a lost reply is a duplicate, not a second check-in; a refusal is
 * held for the person, never dropped.
 */
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount, listOutbox } from "./outbox";
import { queueWellbeingCheckin } from "./wellbeing";

const inserts: Record<string, unknown>[] = [];
let mockInsertError: { code?: string; message: string } | null = null;
/** Rows "already in the database", keyed by patient and checked_in_at. */
let mockExisting: Array<{ patient_id: string; checked_in_at: string }> = [];
let mockSelectError: { message: string } | null = null;

jest.mock("./api", () => ({ ...jest.requireActual("./api") }));
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          limit: async () => {
            if (mockSelectError) return { data: null, error: mockSelectError };
            if (table !== "wellbeing_checkins") return { data: [], error: null };
            const hit = mockExisting.filter((r) => r.patient_id === filters.patient_id && r.checked_in_at === filters.checked_in_at);
            return { data: hit.map(() => ({ id: "row" })), error: null };
          },
        };
        return chain;
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === "wellbeing_checkins") inserts.push(row);
        return { error: mockInsertError };
      },
    }),
  },
}));

beforeEach(() => {
  __resetOutboxForTests();
  inserts.length = 0;
  mockExisting = [];
  mockInsertError = null;
  mockSelectError = null;
});

const payload = { organisation_id: "org-1", mood_score: 2, stress_score: 4, sleep_quality: 3, activity_level: 1, note: null, tags: ["work"] };

describe("wellbeing check-in in the outbox", () => {
  it("is durable on the phone before any network call", async () => {
    await enqueue({ kind: "wellbeing_checkin", subjectId: "user-1", payload });
    expect(inserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
  });

  it("flush sends the scores, tags and the recorded time as the check-in time", async () => {
    const item = await enqueue({ kind: "wellbeing_checkin", subjectId: "user-1", payload: { ...payload, note: "long week" } });
    await flushOutbox();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      organisation_id: "org-1", patient_id: "user-1", mood_score: 2, stress_score: 4, sleep_quality: 3, activity_level: 1,
      note: "long week", tags: ["work"], checked_in_at: item.clientRecordedAt,
    });
    expect(await getPendingCount()).toBe(0);
  });

  it("a check-in the database already has (a lost reply last time) is done, and nothing is inserted twice", async () => {
    const item = await enqueue({ kind: "wellbeing_checkin", subjectId: "user-1", payload });
    mockExisting = [{ patient_id: "user-1", checked_in_at: item.clientRecordedAt }];
    await flushOutbox();
    expect(inserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(0);
  });

  it("CONTROL: a row for a different time or another person does not count as a duplicate", async () => {
    const item = await enqueue({ kind: "wellbeing_checkin", subjectId: "user-1", payload });
    mockExisting = [
      { patient_id: "someone-else", checked_in_at: item.clientRecordedAt },
      { patient_id: "user-1", checked_in_at: "2000-01-01T00:00:00.000Z" },
    ];
    await flushOutbox();
    expect(inserts).toHaveLength(1);
  });

  it("a failed duplicate check keeps the check-in queued instead of inserting blind", async () => {
    mockSelectError = { message: "network" };
    await enqueue({ kind: "wellbeing_checkin", subjectId: "user-1", payload });
    await flushOutbox();
    expect(inserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
  });

  it("a refusal is held for the person, never silently dropped", async () => {
    mockInsertError = { code: "23514", message: "check violation" };
    await enqueue({ kind: "wellbeing_checkin", subjectId: "user-1", payload });
    await flushOutbox();
    const rows = await listOutbox("wellbeing_checkin");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("rejected");
  });
});

describe("queueWellbeingCheckin", () => {
  it("queues the check-in and returns saved, even when the send has not landed", async () => {
    const r = await queueWellbeingCheckin({
      patientId: "user-1", organisationId: "org-1", moodScore: 3, stressScore: 3, sleepQuality: 3, activityLevel: 3, note: "ok", tags: [],
    });
    expect(r).toEqual({ ok: true, data: { queued: true } });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ patient_id: "user-1", organisation_id: "org-1", note: "ok", mood_score: 3 });
  });

  it("with no note it stores null, not an empty string", async () => {
    await queueWellbeingCheckin({ patientId: "user-1", organisationId: "org-1", moodScore: 1, stressScore: 1, sleepQuality: 1, activityLevel: 1 });
    expect(inserts[0]?.note).toBeNull();
  });
});
