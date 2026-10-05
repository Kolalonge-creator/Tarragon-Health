import { recordWeight } from "./page";

/**
 * recordWeight decides how much clinical history each candidate in a patient
 * merge carries — the "highest-stakes tool in the identity spec" per the
 * page's own comment. A silently-swallowed count error used to default to 0,
 * which could make a record with real history look empty right when an
 * operator is choosing which of two records to keep.
 */
type Fail = Partial<Record<string, { message: string }>>;

function fakeSupabase(perTableError: Fail, rpcResult: { data: unknown; error: { message: string } | null } = {
  data: { medications: 3, vitals_readings: 3 },
  error: null,
}) {
  return {
    // Medications and vitals are counted by a permission-gated function (INV-10), not a head-count through RLS.
    rpc: async () => rpcResult,
    from: (table: string) => ({
      select: () => ({
        eq: async () => {
          if (perTableError[table]) {
            return { count: null, error: perTableError[table] };
          }
          return { count: 3, error: null };
        },
      }),
    }),
  } as unknown as Parameters<typeof recordWeight>[0];
}

describe("recordWeight", () => {
  it("returns the real counts when every query succeeds", async () => {
    const weight = await recordWeight(fakeSupabase({}), "patient-1");
    expect(weight).toEqual({ vitals: 3, medications: 3, results: 6, appointments: 3 });
  });

  it("throws instead of defaulting to 0 when any one count query errors", async () => {
    const supabase = fakeSupabase({ appointments: { message: "RLS denied" } });
    await expect(recordWeight(supabase, "patient-1")).rejects.toBeTruthy();
  });

  it("throws when the clinical counts function errors or answers with something unexpected, never defaulting to 0", async () => {
    await expect(recordWeight(fakeSupabase({}, { data: null, error: { message: "not authorised" } }), "patient-1")).rejects.toBeTruthy();
    await expect(recordWeight(fakeSupabase({}, { data: null, error: null }), "patient-1")).rejects.toThrow();
    await expect(recordWeight(fakeSupabase({}, { data: { medications: 3 }, error: null }), "patient-1")).rejects.toThrow();
  });

  it("throws on a lab_result_documents failure too, not just the first table queried", async () => {
    const supabase = fakeSupabase({ lab_result_documents: { message: "connection reset" } });
    await expect(recordWeight(supabase, "patient-1")).rejects.toBeTruthy();
  });
});
