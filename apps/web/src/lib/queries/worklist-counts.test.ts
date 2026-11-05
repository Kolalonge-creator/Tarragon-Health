import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { COUNTERS, type WorklistCountKey } from "./worklist-counts";

type Client = SupabaseClient<Database>;
type CountResult = { count: number | null; error: { message: string } | null };

/**
 * A minimal stand-in for the PostgREST builder: every filter method returns
 * the same object, and the object itself is thenable, so any chain of
 * `.from(...).select(...).eq(...).in(...)` resolves to one fixed result. That
 * is enough to assert the only thing this test cares about — whether a
 * counter reports a failed query as a number or as a rejection.
 *
 * `rpc` is stubbed separately on the same fixed `result` (mapped from
 * `count` to `data`, matching what `.rpc()` actually returns) so the one
 * counter that can't be expressed as a PostgREST filter chain
 * (careThreadsAwaitingReply, which compares two columns to each other) is
 * covered by the exact same three generic-success/null/error cases as every
 * other counter here, rather than needing its own bespoke test.
 */
function stubClient(result: CountResult): Client {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: CountResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["from", "select", "eq", "neq", "in", "or", "is", "gte", "not"]) {
    builder[method] = () => builder;
  }
  // list_second_opinion_worklist returns the open requests themselves (an array), not a number; the counter takes its length.
  builder.rpc = (fn: string) =>
    Promise.resolve({
      data: fn === "list_second_opinion_worklist" && result.count !== null ? Array.from({ length: result.count }) : result.count,
      error: result.error,
    });
  return builder as unknown as Client;
}

const KEYS = Object.keys(COUNTERS) as WorklistCountKey[];

describe("worklist counters", () => {
  it("covers every worklist the clinician dashboard counts", () => {
    expect(KEYS.length).toBe(37);
  });

  it.each(KEYS)("%s returns the live count when the query succeeds", async (key) => {
    await expect(COUNTERS[key](stubClient({ count: 7, error: null }))).resolves.toBe(7);
  });

  it.each(KEYS)("%s treats a null count on a successful query as zero", async (key) => {
    await expect(COUNTERS[key](stubClient({ count: null, error: null }))).resolves.toBe(0);
  });

  /**
   * The defect this guards against: `const { count } = await ...; return count
   * ?? 0` swallows the error and renders a failed query as a confident "0" on
   * a doctor's "what needs you today" strip. Every counter must reject so the
   * consuming components reach their isError branch instead.
   */
  it.each(KEYS)("%s rejects rather than reporting 0 when the query fails", async (key) => {
    await expect(
      COUNTERS[key](stubClient({ count: null, error: { message: "permission denied" } }))
    ).rejects.toEqual({ message: "permission denied" });
  });
});

/**
 * INV-13: a test account must never appear in a staff member's headline
 * numbers. Every counter over a table with a `patient_id` column applies the
 * exclusion when test ids are supplied; the RPC-backed counters leave it to
 * the function (they never touch the filter builder).
 */
describe("worklist counters exclude test patients (INV-13)", () => {
  type Filter = { method: string; args: unknown[] };

  function recordingClient(filters: Filter[]): Client {
    const builder: Record<string, unknown> = {
      then: (resolve: (value: CountResult) => unknown) =>
        Promise.resolve({ count: 3, error: null }).then(resolve),
    };
    for (const method of ["from", "select", "eq", "neq", "in", "or", "is", "gte", "not"]) {
      builder[method] = (...args: unknown[]) => {
        filters.push({ method, args });
        return builder;
      };
    }
    builder.rpc = () => Promise.resolve({ data: 3, error: null });
    return builder as unknown as Client;
  }

  const TABLE_BACKED = KEYS.filter((key) => {
    const filters: Filter[] = [];
    void COUNTERS[key](recordingClient(filters), []);
    return filters.some((f) => f.method === "from");
  });

  // The one table-backed counter deliberately left alone (owned by a concurrent change) and the one nullable column.
  const NOT_YET_EXCLUDED: WorklistCountKey[] = ["labOrdersAwaitingHomeVisitAssignment"];
  const NULLABLE_PATIENT_COLUMN: WorklistCountKey[] = ["openSafetyIncidents"];
  // Tables that name the patient column something other than patient_id.
  const PATIENT_COLUMN: Partial<Record<WorklistCountKey, string>> = { vaccinationVerifications: "profile_id" };
  // Tables whose patient column staff may not read (S22 written questions): they exclude test data through their own stamped
  // is_test instead. Filtering on the hidden column is refused with a 403, which left the badge and the whole sidebar warning on.
  const OWN_IS_TEST_FLAG: WorklistCountKey[] = ["asyncConsults"];

  it.each(OWN_IS_TEST_FLAG)("%s excludes test data by its own is_test and never filters the hidden patient column", async (key) => {
    const filters: Filter[] = [];
    await COUNTERS[key](recordingClient(filters), ["t1", "t2"]);
    expect(filters).toContainEqual({ method: "eq", args: ["is_test", false] });
    expect(filters.map((f) => f.args[0])).not.toContain("patient_id");
  });

  it.each(
    TABLE_BACKED.filter(
      (k) => !NOT_YET_EXCLUDED.includes(k) && !NULLABLE_PATIENT_COLUMN.includes(k) && !OWN_IS_TEST_FLAG.includes(k)
    )
  )(
    "%s filters out the supplied test patient ids",
    async (key) => {
      const filters: Filter[] = [];
      await COUNTERS[key](recordingClient(filters), ["t1", "t2"]);
      expect(filters).toContainEqual({
        method: "not",
        args: [PATIENT_COLUMN[key] ?? "patient_id", "in", "(t1,t2)"],
      });
    }
  );

  it.each(NULLABLE_PATIENT_COLUMN)("%s keeps rows about no patient while excluding test patients", async (key) => {
    const filters: Filter[] = [];
    await COUNTERS[key](recordingClient(filters), ["t1"]);
    expect(filters).toContainEqual({ method: "or", args: ["patient_id.is.null,patient_id.not.in.(t1)"] });
  });

  it.each(TABLE_BACKED)("%s adds no filter when there is no test patient", async (key) => {
    const filters: Filter[] = [];
    await COUNTERS[key](recordingClient(filters), []);
    expect(filters.filter((f) => f.method === "not" || f.method === "or").map((f) => f.args[0])).not.toContain(
      "patient_id"
    );
  });
});
