import { describe, expect, it } from "@jest/globals";
import { excludeTestPatients, fetchTestPatientIds } from "./real-patients";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

type Call = { method: "not" | "or"; args: unknown[] };

/** Records every filter call; both methods return the same builder so chains keep working. */
function stubBuilder() {
  const calls: Call[] = [];
  const builder = {
    not: (...args: unknown[]) => {
      calls.push({ method: "not", args });
      return builder;
    },
    or: (...args: unknown[]) => {
      calls.push({ method: "or", args });
      return builder;
    },
  };
  return { builder, calls };
}

describe("excludeTestPatients", () => {
  it("leaves the query untouched when there is no test patient to exclude", () => {
    const { builder, calls } = stubBuilder();
    expect(excludeTestPatients(builder, [])).toBe(builder);
    expect(calls).toEqual([]);
  });

  it("applies one not-in filter on patient_id, in PostgREST list syntax, when the list is non-empty", () => {
    const { builder, calls } = stubBuilder();
    excludeTestPatients(builder, ["a", "b"]);
    expect(calls).toEqual([{ method: "not", args: ["patient_id", "in", "(a,b)"] }]);
  });

  it("filters a different column when asked", () => {
    const { builder, calls } = stubBuilder();
    excludeTestPatients(builder, ["a"], { column: "subject_patient_id" });
    expect(calls).toEqual([{ method: "not", args: ["subject_patient_id", "in", "(a)"] }]);
  });

  it("keeps rows with no patient at all when the column is nullable", () => {
    // SQL `NULL NOT IN (...)` is NULL, so a plain not-in would drop an incident report about no patient.
    const { builder, calls } = stubBuilder();
    excludeTestPatients(builder, ["a", "b"], { nullable: true });
    expect(calls).toEqual([{ method: "or", args: ["patient_id.is.null,patient_id.not.in.(a,b)"] }]);
  });
});

describe("fetchTestPatientIds", () => {
  type Result = { data: { id: string }[] | null; error: { message: string } | null };

  function stubClient(result: Result, filters: unknown[][]) {
    const builder: Record<string, unknown> = {
      then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    builder.select = () => builder;
    builder.eq = (...args: unknown[]) => {
      filters.push(args);
      return builder;
    };
    return { from: () => builder } as unknown as SupabaseClient<Database>;
  }

  it("returns the ids of test patients only", async () => {
    const filters: unknown[][] = [];
    const ids = await fetchTestPatientIds(stubClient({ data: [{ id: "t1" }, { id: "t2" }], error: null }, filters));
    expect(ids).toEqual(["t1", "t2"]);
    expect(filters).toEqual([
      ["is_test", true],
      ["role", "patient"],
    ]);
  });

  it("throws on a failed read rather than reporting no test patients", async () => {
    await expect(
      fetchTestPatientIds(stubClient({ data: null, error: { message: "permission denied" } }, []))
    ).rejects.toEqual({ message: "permission denied" });
  });
});
