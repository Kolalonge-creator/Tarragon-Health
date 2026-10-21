/**
 * S49a: a meal in words rides the one offline outbox. Proves the acceptance path on the phone: a recent meal is repeated in ONE call and is
 * durable with no network at all; the client id is the idempotency key; a refusal is held for the person, never silently dropped.
 */
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount, listOutbox } from "./outbox";

const mockPosts: { payload: { meal_type: string; description: string }; clientId: string; recordedAt: string }[] = [];
let mockResult: { success: boolean; error?: string; status?: number } = { success: true };

jest.mock("./api", () => ({
  ...jest.requireActual("./api"),
  postMealLog: async (payload: { meal_type: string; description: string }, clientId: string, recordedAt: string) => {
    mockPosts.push({ payload, clientId, recordedAt });
    return mockResult;
  },
}));
jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) } },
}));

import { mealTypeForLagosHour, recentDistinctMeals } from "./food-diary-model";

beforeEach(() => {
  __resetOutboxForTests();
  mockPosts.length = 0;
  mockResult = { success: true };
});

describe("meal in the outbox", () => {
  it("is durable on the phone before any network call", async () => {
    await enqueue({ kind: "meal", subjectId: "p1", payload: { meal_type: "lunch", description: "a wrap of eba and a ladle of egusi soup" } });
    expect(mockPosts).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
  });

  it("repeating a recent meal is one enqueue call and nothing else", async () => {
    const entries = [
      { id: "1", mealType: "lunch" as const, description: "jollof rice and chicken" },
      { id: "2", mealType: "dinner" as const, description: "Jollof rice and chicken " },
      { id: "3", mealType: "snack" as const, description: null },
    ];
    const [recent] = recentDistinctMeals(entries, 5);
    await enqueue({ kind: "meal", subjectId: "p1", payload: { meal_type: recent!.mealType, description: recent!.description! } });
    const rows = await listOutbox("meal");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ meal_type: "lunch", description: "jollof rice and chicken" });
  });

  it("flush sends only the words, with the client id as the idempotency key", async () => {
    const item = await enqueue({ kind: "meal", subjectId: "p1", payload: { meal_type: "dinner", description: "pap and 2 akara" } });
    const r = await flushOutbox();
    expect(r.synced).toBe(1);
    expect(mockPosts).toHaveLength(1);
    expect(mockPosts[0]!.clientId).toBe(item.clientId);
    expect(Object.keys(mockPosts[0]!.payload).sort()).toEqual(["description", "meal_type"]);
    expect(await getPendingCount()).toBe(0);
  });

  it("an outage keeps the meal and stops the run", async () => {
    await enqueue({ kind: "meal", subjectId: "p1", payload: { meal_type: "lunch", description: "rice" } });
    mockResult = { success: false, error: "Network request failed" };
    const r = await flushOutbox();
    expect(r.stoppedOffline).toBe(true);
    expect(await getPendingCount()).toBe(1);
  });

  it("a refusal (400) is held as rejected for the person, not dropped", async () => {
    await enqueue({ kind: "meal", subjectId: "p1", payload: { meal_type: "lunch", description: "rice" } });
    mockResult = { success: false, error: "Invalid input", status: 400 };
    const r = await flushOutbox();
    expect(r.newlyRejected).toBe(1);
    const rows = await listOutbox("meal");
    expect(rows[0]!.state).toBe("rejected");
  });
});

describe("recentDistinctMeals / mealTypeForLagosHour", () => {
  it("skips photo-only meals and repeats of the same words", () => {
    const out = recentDistinctMeals(
      [
        { id: "a", mealType: "lunch" as const, description: "rice" },
        { id: "b", mealType: "lunch" as const, description: "  RICE" },
        { id: "c", mealType: "lunch" as const, description: "" },
        { id: "d", mealType: "dinner" as const, description: "beans" },
      ],
      5,
    );
    expect(out.map((e) => e.id)).toEqual(["a", "d"]);
  });

  it("picks a meal type from the Lagos clock", () => {
    expect(mealTypeForLagosHour(new Date("2026-10-20T06:00:00Z"))).toBe("breakfast"); // 07:00 Lagos
    expect(mealTypeForLagosHour(new Date("2026-10-20T12:00:00Z"))).toBe("lunch"); // 13:00
    expect(mealTypeForLagosHour(new Date("2026-10-20T17:00:00Z"))).toBe("dinner"); // 18:00
    expect(mealTypeForLagosHour(new Date("2026-10-20T21:30:00Z"))).toBe("snack"); // 22:30
  });
});
