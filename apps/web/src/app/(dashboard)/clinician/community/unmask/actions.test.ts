const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { doctorUnmaskAction } from "./actions";

const G = "22222222-2222-4222-8222-222222222222";
const U = "11111111-1111-4111-8111-111111111111";
const REASON = "Safety review of a flagged post";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => rpc.mockReset());

describe("doctorUnmaskAction", () => {
  it("returns the name only, never the profile id", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", profile_id: U, full_name: "Ada Obi" }, error: null });
    const r = await doctorUnmaskAction(undefined, form({ group_id: G, handle: "calm-heron", reason: REASON }));
    expect(r?.ok).toBe(true);
    expect(r?.result).toEqual({ full_name: "Ada Obi" });
    expect(JSON.stringify(r)).not.toContain(U);
    expect(r?.message).toMatch(/Chief Medical Officer and the data protection officer have been told/);
    expect(rpc).toHaveBeenCalledWith("community_admin_unmask", { p_group_id: G, p_handle: "calm-heron", p_reason: REASON });
  });
  it("validates input before calling the database", async () => {
    expect((await doctorUnmaskAction(undefined, form({ group_id: "bad", handle: "h", reason: REASON })))?.ok).toBe(false);
    expect((await doctorUnmaskAction(undefined, form({ group_id: G, handle: "", reason: REASON })))?.ok).toBe(false);
    expect((await doctorUnmaskAction(undefined, form({ group_id: G, handle: "h", reason: "short" })))?.message).toMatch(/at least 20/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps refusals to plain English", async () => {
    rpc.mockResolvedValue({ data: { status: "refused", reason: "no_safety_signal" }, error: null });
    const r = await doctorUnmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/no recent safety concern about that name in that group/);
    rpc.mockResolvedValue({ data: { status: "refused", reason: "daily_limit" }, error: null });
    expect((await doctorUnmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON })))?.message).toMatch(/today's limit/);
    rpc.mockResolvedValue({ data: { status: "refused", reason: "something_new" }, error: null });
    expect((await doctorUnmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON })))?.message).toBe("That could not be done. Please try again.");
  });
  it("says who this is for on a permission refusal and never leaks raw text", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "admins, the Chief Medical Officer and doctors only" } });
    expect((await doctorUnmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON })))?.message).toBe("This is for doctors, the Chief Medical Officer and admins.");
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "select full_name from profiles failed" } });
    expect((await doctorUnmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON })))?.message).not.toMatch(/profiles|select/);
    rpc.mockResolvedValue({ data: { weird: true }, error: null });
    expect((await doctorUnmaskAction(undefined, form({ group_id: G, handle: "h", reason: REASON })))?.ok).toBe(false);
  });
});
