import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ASSISTANT_GUARD_KEY, ASSISTANT_NOT_OPEN_REPLY, isAssistantOpen } from "./guard";
import { runCoachTurn } from "./index";
import { runQuickAction } from "./quick-actions";

function client(rpcResult: unknown | Error) {
  const from = jest.fn();
  const rpc = jest.fn(async (..._args: unknown[]) => {
    if (rpcResult instanceof Error) throw rpcResult;
    return rpcResult;
  });
  return { supabase: { from, rpc } as unknown as SupabaseClient<Database>, from, rpc };
}

describe("assistant_enabled guard (INV-14) fails closed", () => {
  it("is open only when the database says true", async () => {
    expect(await isAssistantOpen(client({ data: true, error: null }).supabase)).toBe(true);
  });
  it.each([
    ["off", { data: false, error: null }],
    ["null", { data: null, error: null }],
    ["an error", { data: null, error: { message: "boom" } }],
    ["a string", { data: "true", error: null }],
    ["a thrown error", new Error("network")],
  ])("is closed on %s", async (_name, result) => {
    expect(await isAssistantOpen(client(result as unknown).supabase)).toBe(false);
  });

  it("asks for the assistant_enabled key", async () => {
    const c = client({ data: true, error: null });
    await isAssistantOpen(c.supabase);
    expect(c.rpc.mock.calls[0]).toEqual(["go_live_guard_is_open", { p_key: ASSISTANT_GUARD_KEY }]);
    expect(ASSISTANT_GUARD_KEY).toBe("assistant_enabled");
  });

  it("runCoachTurn does nothing at all while the guard is closed: no read, no write, no model, no service client", async () => {
    const c = client({ data: false, error: null });
    const getServiceRoleSupabase = jest.fn();
    const out = await runCoachTurn({
      supabase: c.supabase,
      getServiceRoleSupabase: getServiceRoleSupabase as never,
      profileId: "p1",
      organisationId: "o1",
      message: "hello",
    });
    expect(out.notOpen).toBe(true);
    expect(out.reply).toBe(ASSISTANT_NOT_OPEN_REPLY);
    expect(out.sources).toEqual([]);
    expect(c.from).not.toHaveBeenCalled();
    expect(getServiceRoleSupabase).not.toHaveBeenCalled();
  });

  it("runCoachTurn is closed when the guard cannot be read", async () => {
    const c = client(new Error("db down"));
    const out = await runCoachTurn({
      supabase: c.supabase,
      getServiceRoleSupabase: jest.fn() as never,
      profileId: "p1",
      organisationId: "o1",
      message: "hello",
    });
    expect(out.notOpen).toBe(true);
    expect(c.from).not.toHaveBeenCalled();
  });

  it("runQuickAction is closed too", async () => {
    const c = client({ data: false, error: null });
    const out = await runQuickAction({
      supabase: c.supabase,
      getServiceRoleSupabase: jest.fn() as never,
      profileId: "p1",
      organisationId: "o1",
      kind: "explain_record",
    });
    expect(out.reply).toBe(ASSISTANT_NOT_OPEN_REPLY);
    expect(c.from).not.toHaveBeenCalled();
  });
});
