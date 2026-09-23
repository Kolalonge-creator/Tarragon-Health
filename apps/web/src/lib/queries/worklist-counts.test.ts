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
  builder.rpc = () => Promise.resolve({ data: result.count, error: result.error });
  return builder as unknown as Client;
}

const KEYS = Object.keys(COUNTERS) as WorklistCountKey[];

describe("worklist counters", () => {
  it("covers every worklist the clinician dashboard counts", () => {
    expect(KEYS.length).toBe(36);
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
