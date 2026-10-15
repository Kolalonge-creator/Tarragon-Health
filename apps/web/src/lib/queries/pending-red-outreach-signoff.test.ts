import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { readPendingRedOutreachSignoff } from "./pending-red-outreach-signoff";

function client(result: { data: unknown; error: unknown } | "throw"): SupabaseClient<Database> {
  return {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => (result === "throw" ? Promise.reject(new Error("x")) : Promise.resolve(result)) }) }) }),
  } as unknown as SupabaseClient<Database>;
}

describe("readPendingRedOutreachSignoff", () => {
  it("is waiting while the type needs confirming and is not confirmed", async () => {
    await expect(readPendingRedOutreachSignoff(client({ data: [{ needs_confirmation: true, confirmed_at: null }], error: null }))).resolves.toEqual({ waiting: true, failed: false });
  });
  it("is not waiting once confirmed", async () => {
    await expect(readPendingRedOutreachSignoff(client({ data: [{ needs_confirmation: true, confirmed_at: "2026-10-14T09:00:00Z" }], error: null }))).resolves.toEqual({ waiting: false, failed: false });
  });
  it("is not waiting when the type does not exist yet (the migration is not applied)", async () => {
    await expect(readPendingRedOutreachSignoff(client({ data: [], error: null }))).resolves.toEqual({ waiting: false, failed: false });
  });
  it("reports a failed read and a thrown read as failed, never as nothing waiting", async () => {
    await expect(readPendingRedOutreachSignoff(client({ data: null, error: { message: "x" } }))).resolves.toEqual({ waiting: false, failed: true });
    await expect(readPendingRedOutreachSignoff(client("throw"))).resolves.toEqual({ waiting: false, failed: true });
  });
});
