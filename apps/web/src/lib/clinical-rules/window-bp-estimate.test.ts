import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { evaluateWindow } from "./window";

/** A query builder that records every call and resolves to a count, like the supabase-js builder's thenable end. */
function fakeClient() {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "is", "gte", "lte", "gt", "lt"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: { count: number; error: null }) => unknown) => resolve({ count: 3, error: null });
  const client = { from: () => builder } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const bpWindow = { metric: "vital_reading", vital_type: "blood_pressure", comparator: "gte", threshold: 140, days: 7 } as const;

describe("a clinical rule over repeated blood pressure readings", () => {
  it("never counts a wearable estimate", async () => {
    const { client, calls } = fakeClient();
    await expect(evaluateWindow(client, "p1", bpWindow)).resolves.toBe(3);
    expect(calls).toContainEqual(["neq", ["source", "wearable"]]);
  });

  it("does not exclude any source for another vital (pulse is unchanged)", async () => {
    const { client, calls } = fakeClient();
    await evaluateWindow(client, "p1", { ...bpWindow, vital_type: "pulse", threshold: 120 });
    expect(calls.some(([m]) => m === "neq")).toBe(false);
  });
});
