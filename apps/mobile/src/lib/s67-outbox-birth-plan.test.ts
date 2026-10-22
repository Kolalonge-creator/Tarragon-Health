/** S67 follow-up: the birth plan goes through the one offline outbox as an idempotent upsert keyed by pregnancy. */
import { __resetOutboxForTests, enqueue, flushOutbox, getPendingCount } from "./outbox";
import type { BirthPlanPayload } from "./pregnancy-payloads";

const mockUpserts: { table: string; row: Record<string, unknown>; opts: { onConflict: string } }[] = [];
let mockUpsertError: { code?: string; message?: string } | null = null;
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      upsert: async (row: Record<string, unknown>, opts: { onConflict: string }) => {
        mockUpserts.push({ table, row, opts });
        return { error: mockUpsertError };
      },
    }),
  },
}));

const PAYLOAD: BirthPlanPayload = {
  pregnancy_id: "preg-1",
  organisation_id: "org-1",
  plan: {
    place_of_birth: "Clinic", transport_plan: null, money_plan_kobo: 100, money_plan_note: null, blood_donor_name: null, blood_donor_phone: null,
    escort_name: null, escort_phone: null, long_journey: false, previous_fast_labour: false, previous_births: 0,
  },
};

beforeEach(() => {
  __resetOutboxForTests();
  mockUpserts.length = 0;
  mockUpsertError = null;
});

describe("birth plan in the outbox", () => {
  it("is held on the phone before any network call, then upserted once keyed by pregnancy", async () => {
    await enqueue({ kind: "birth_plan", subjectId: "p1", payload: PAYLOAD, danger: false });
    expect(mockUpserts).toHaveLength(0);
    expect(await getPendingCount()).toBe(1);
    await flushOutbox();
    expect(mockUpserts).toHaveLength(1);
    expect(mockUpserts[0]).toMatchObject({
      table: "birth_plans",
      opts: { onConflict: "pregnancy_id" },
      row: { patient_id: "p1", organisation_id: "org-1", pregnancy_id: "preg-1", source: "patient", place_of_birth: "Clinic" },
    });
    expect(await getPendingCount()).toBe(0);
  });

  it("stays queued when the server cannot be reached", async () => {
    mockUpsertError = { message: "Network request failed" };
    await enqueue({ kind: "birth_plan", subjectId: "p1", payload: PAYLOAD, danger: false });
    await flushOutbox();
    expect(await getPendingCount()).toBe(1);
  });
});
