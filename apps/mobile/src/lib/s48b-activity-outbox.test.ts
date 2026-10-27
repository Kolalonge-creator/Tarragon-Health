/**
 * S48b: a workout rides the one offline outbox. Durable on the phone before any network call; the client id is the idempotency key; a duplicate is
 * success; a refusal is held for the person. Plus the pure entry rules for the Movement screen.
 */
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount, listOutbox } from "./outbox";
import { parseActivityEntry, parseWeeklyGoal, ACTIVITY_KIND_CHOICES } from "./activity-movement-model";

const inserts: Record<string, unknown>[] = [];
let mockInsertError: { code?: string; message: string } | null = null;

jest.mock("./api", () => ({ ...jest.requireActual("./api") }));
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        if (table === "activity_log_entries") inserts.push(row);
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

const payload = { activity_kind: "dancing" as const, duration_minutes: 30, distance_m: null, logged_on: "2026-10-21" };

describe("activity in the outbox", () => {
  it("is durable on the phone before any network call", async () => {
    await enqueue({ kind: "activity", subjectId: "user-1", payload });
    expect(inserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
  });

  it("flush sends the kind, minutes and distance with the client id as the idempotency key", async () => {
    const item = await enqueue({ kind: "activity", subjectId: "user-1", payload: { ...payload, activity_kind: "walking", distance_m: 2500 } });
    await flushOutbox();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      organisation_id: "org-1", patient_id: "user-1", entry_type: "workout", activity_kind: "walking", duration_minutes: 30, distance_m: 2500,
      logged_on: "2026-10-21", client_id: item.clientId,
    });
    expect(await getPendingCount()).toBe(0);
  });

  it("a duplicate (23505) counts as done, not a second workout", async () => {
    mockInsertError = { code: "23505", message: "duplicate key" };
    await enqueue({ kind: "activity", subjectId: "user-1", payload });
    await flushOutbox();
    expect(await getPendingCount()).toBe(0);
  });

  it("a refusal is held for the person, never silently dropped", async () => {
    mockInsertError = { code: "23514", message: "check violation" };
    await enqueue({ kind: "activity", subjectId: "user-1", payload });
    await flushOutbox();
    const rows = await listOutbox("activity");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("rejected");
  });
});

describe("Movement entry rules", () => {
  const now = Date.parse("2026-10-21T23:30:00Z"); // 00:30 on the 22nd in Lagos

  it("builds the payload with the Lagos day and distance in whole metres", () => {
    const r = parseActivityEntry({ kind: "cycling", minutes: "45", distance_km: "12,5" }, now);
    expect(r).toEqual({ ok: true, payload: { activity_kind: "cycling", duration_minutes: 45, distance_m: 12500, logged_on: "2026-10-22" } });
  });

  it("distance is optional", () => {
    const r = parseActivityEntry({ kind: "chair_based", minutes: "15", distance_km: "" }, now);
    expect(r.ok && r.payload.distance_m).toBeNull();
  });

  it("offers all seven kinds including farm and manual work and chair-based", () => {
    expect(ACTIVITY_KIND_CHOICES.map((c) => c.value)).toEqual(["walking", "running", "cycling", "dancing", "football", "farm_manual_work", "chair_based"]);
  });

  it.each([
    [{ kind: "", minutes: "30" }],
    [{ kind: "swimming", minutes: "30" }],
    [{ kind: "walking", minutes: "" }],
    [{ kind: "walking", minutes: "0" }],
    [{ kind: "walking", minutes: "12.5" }],
    [{ kind: "walking", minutes: "1001" }],
    [{ kind: "walking", minutes: "abc" }],
    [{ kind: "walking", minutes: "30", distance_km: "1.2.3" }],
    [{ kind: "walking", minutes: "30", distance_km: "2000" }],
    [{ kind: "walking", minutes: "30", distance_km: "." }],
  ])("refuses %j with a plain message", (values) => {
    const r = parseActivityEntry(values as Record<string, string>, now);
    expect(r.ok).toBe(false);
  });

  it("the weekly goal is a whole number of minutes in a week", () => {
    expect(parseWeeklyGoal("150")).toEqual({ ok: true, minutes: 150 });
    for (const bad of ["", "0", "10081", "1.5", "x"]) expect(parseWeeklyGoal(bad).ok).toBe(false);
  });
});
