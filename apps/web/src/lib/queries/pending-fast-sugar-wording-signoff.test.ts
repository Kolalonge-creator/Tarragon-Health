import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

jest.mock("server-only", () => ({}));
import { FAST_SUGAR_CONDITION, FAST_SUGAR_GUARD, FAST_SUGAR_ITEM_KEY, readPendingFastSugarWordingSignoff } from "./pending-fast-sugar-wording-signoff";

const guard = (key: string, conditions: Array<{ code: string; met: boolean }>) => ({
  key,
  label: key,
  blocks: "b",
  condition_text: "c",
  switch_role: "cmo",
  enforced_in: [],
  not_enforced_in: "n",
  is_on: false,
  changed_at: null,
  changed_by_name: null,
  change_note: null,
  conditions: conditions.map((c) => ({ code: c.code, label: c.code, met: c.met, source: "attestation" as const })),
  all_met: conditions.every((c) => c.met),
  recent: [],
});

function client(result: { data: unknown; error: { message: string } | null } | "throw") {
  return {
    rpc: async () => {
      if (result === "throw") throw new Error("down");
      return result;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("readPendingFastSugarWordingSignoff", () => {
  it("has stable keys", () => {
    expect([FAST_SUGAR_ITEM_KEY, FAST_SUGAR_GUARD, FAST_SUGAR_CONDITION]).toEqual(["glucose_fast_sugar_wording", "glucose_fast_sugar_wording", "fast_sugar_wording_signed"]);
  });
  it("waits while the condition is not met", async () => {
    const r = await readPendingFastSugarWordingSignoff(client({ data: [guard(FAST_SUGAR_GUARD, [{ code: FAST_SUGAR_CONDITION, met: false }])], error: null }));
    expect(r).toEqual({ waiting: true, failed: false });
  });
  it("does not wait once signed", async () => {
    const r = await readPendingFastSugarWordingSignoff(client({ data: [guard(FAST_SUGAR_GUARD, [{ code: FAST_SUGAR_CONDITION, met: true }])], error: null }));
    expect(r).toEqual({ waiting: false, failed: false });
  });
  it("a guard that does not exist yet is neither a line nor a failure", async () => {
    expect(await readPendingFastSugarWordingSignoff(client({ data: [guard("other", [])], error: null }))).toEqual({ waiting: false, failed: false });
  });
  it("a guard with no such condition, an error, a malformed answer or a throw is a failure, never an all-clear", async () => {
    expect(await readPendingFastSugarWordingSignoff(client({ data: [guard(FAST_SUGAR_GUARD, [])], error: null }))).toEqual({ waiting: false, failed: true });
    expect(await readPendingFastSugarWordingSignoff(client({ data: null, error: { message: "denied" } }))).toEqual({ waiting: false, failed: true });
    expect(await readPendingFastSugarWordingSignoff(client({ data: "nope", error: null }))).toEqual({ waiting: false, failed: true });
    expect(await readPendingFastSugarWordingSignoff(client("throw"))).toEqual({ waiting: false, failed: true });
  });
});
