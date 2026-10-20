import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMyPhones, reportPhoneLost } from "./phones";

const row = (over: Record<string, unknown> = {}) => ({
  device_id: "d1",
  platform: "ios",
  registered_at: null,
  last_checkin_at: "2026-10-19T00:00:00Z",
  lease_expires_at: "2026-11-19T00:00:00Z",
  revoked_at: null,
  revoke_reason: null,
  wipe_confirmed_at: null,
  wipe_reason: null,
  unsent_at_wipe: null,
  danger_at_wipe: null,
  retired_at: null,
  ...over,
});

function selectClient(result: { data: unknown; error: unknown }) {
  const calls: string[] = [];
  const chain = {
    select: (cols: string) => {
      calls.push(cols);
      return chain;
    },
    order: () => chain,
    limit: async () => result,
  };
  return { client: { from: () => chain } as unknown as SupabaseClient, calls };
}

describe("fetchMyPhones", () => {
  it("returns the rows and never asks for a column that could carry content", async () => {
    const { client, calls } = selectClient({ data: [row(), { junk: true }], error: null });
    const r = await fetchMyPhones(client);
    expect(r).toEqual({ ok: true, phones: [row()] });
    expect(calls[0]).not.toMatch(/token|key/);
  });

  it("reports a failed read as failed, never as an empty list", async () => {
    const { client } = selectClient({ data: null, error: { message: "boom" } });
    expect(await fetchMyPhones(client)).toEqual({ ok: false });
  });
});

describe("reportPhoneLost", () => {
  const rpc = (result: { data: unknown; error: unknown }) => {
    const fn = jest.fn(async () => result);
    return { client: { rpc: fn } as unknown as SupabaseClient, fn };
  };

  it("asks the server to clear the phone with the lost-phone reason", async () => {
    const { client, fn } = rpc({ data: true, error: null });
    expect(await reportPhoneLost(client, "d1")).toBe(true);
    expect(fn).toHaveBeenCalledWith("request_offline_device_wipe", { p_device: "d1", p_reason: "lost_phone" });
  });

  it("is false on a server error or a refusal, so the page never claims it was reported", async () => {
    expect(await reportPhoneLost(rpc({ data: null, error: { code: "42501" } }).client, "d1")).toBe(false);
    expect(await reportPhoneLost(rpc({ data: false, error: null }).client, "d1")).toBe(false);
  });
});
