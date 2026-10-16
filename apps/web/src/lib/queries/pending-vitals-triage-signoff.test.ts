import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

jest.mock("server-only", () => ({}));
import { VITALS_TRIAGE_ITEM_KEY, readPendingVitalsTriageSignoff } from "./pending-vitals-triage-signoff";

function client(result: { data: unknown; error: { message: string } | null } | "throw") {
  return {
    from: () => ({
      select: () => ({
        eq: async () => {
          if (result === "throw") throw new Error("down");
          return result;
        },
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("readPendingVitalsTriageSignoff", () => {
  it("has a stable hub key", () => expect(VITALS_TRIAGE_ITEM_KEY).toBe("vitals_triage_rule_set"));

  it("a draft with nothing approved is pending", async () => {
    const r = await readPendingVitalsTriageSignoff(client({ data: [{ id: "a", version: 1, status: "draft", note: "n" }], error: null }));
    expect(r).toEqual({ pending: true, version: 1, approvedVersion: null, note: "n", failed: false });
  });

  it("a draft newer than the approved version is pending, an older draft is not", async () => {
    const newer = await readPendingVitalsTriageSignoff(client({ data: [{ version: 1, status: "approved", note: null }, { version: 2, status: "draft", note: null }], error: null }));
    expect(newer).toMatchObject({ pending: true, version: 2, approvedVersion: 1 });
    const older = await readPendingVitalsTriageSignoff(client({ data: [{ version: 3, status: "approved", note: null }, { version: 2, status: "draft", note: null }], error: null }));
    expect(older).toMatchObject({ pending: false, approvedVersion: 3, failed: false });
  });

  it("nothing at all means nothing is pending (not a failure)", async () => {
    expect(await readPendingVitalsTriageSignoff(client({ data: [], error: null }))).toMatchObject({ pending: false, failed: false });
  });

  it("a failed read says so and never looks like an all-clear", async () => {
    expect(await readPendingVitalsTriageSignoff(client({ data: null, error: { message: "x" } }))).toMatchObject({ pending: false, failed: true });
    expect(await readPendingVitalsTriageSignoff(client("throw"))).toMatchObject({ pending: false, failed: true });
  });
});
