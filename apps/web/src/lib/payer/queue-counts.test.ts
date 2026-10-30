import type { SupabaseClient } from "@supabase/supabase-js";
import { readPayerQueueCounts } from "./queue-counts";

type Call = { table: string; select: string; eq: [string, unknown][]; in: [string, unknown[]][] };
type Reply = { count: number | null; error: unknown };

/** A chainable stand-in that records how each count was scoped and answers per table + filter. */
function fakeClient(answer: (c: Call) => Reply) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: "", eq: [], in: [] };
      const chain = {
        select(s: string) {
          call.select = s;
          return chain;
        },
        eq(col: string, val: unknown) {
          call.eq.push([col, val]);
          return chain;
        },
        in(col: string, vals: unknown[]) {
          call.in.push([col, vals]);
          return chain;
        },
        then(resolve: (r: Reply) => unknown) {
          calls.push(call);
          return Promise.resolve(answer(call)).then(resolve);
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("readPayerQueueCounts", () => {
  it("scopes every count to the selected insurer with an inner join, and reads the right statuses", async () => {
    const { client, calls } = fakeClient((c) => ({
      count: c.table === "insurance_preauthorizations" ? 4 : c.in[0][1].includes("submitted") ? 7 : 2,
      error: null,
    }));
    const counts = await readPayerQueueCounts(client, "ins-1");
    expect(counts).toEqual({ preauthPending: 4, claimsToAdjudicate: 7, claimsToPay: 2 });
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.select).toContain("insurance_policies!inner");
      expect(c.eq).toContainEqual(["insurance_policies.insurer_id", "ins-1"]);
    }
    expect(calls[0].eq).toContainEqual(["status", "pending"]);
    expect(calls[1].in).toEqual([["status", ["submitted", "adjudicating"]]]);
    expect(calls[2].in).toEqual([["status", ["approved", "partially_approved"]]]);
  });

  it("returns null, not zero, for a count that errored or had no count", async () => {
    const { client } = fakeClient((c) =>
      c.table === "insurance_preauthorizations"
        ? { count: null, error: { message: "boom" } }
        : c.in[0][1].includes("submitted")
          ? { count: null, error: null }
          : { count: 0, error: null },
    );
    expect(await readPayerQueueCounts(client, "ins-1")).toEqual({
      preauthPending: null,
      claimsToAdjudicate: null,
      claimsToPay: 0,
    });
  });
});
