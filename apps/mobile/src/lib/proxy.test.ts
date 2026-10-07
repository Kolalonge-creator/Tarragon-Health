const mockRpc = jest.fn();
const mockOtp = jest.fn();
jest.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
jest.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithOtp: (...a: unknown[]) => mockOtp(...a) } }) }));

import { completeHandover, confirmProxySetup, endProxyAccess, loadMyHandover, loadPendingProxySetups, loadProxyArrangements, startProxySetup } from "./proxy";

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockOtp.mockReset().mockResolvedValue({ error: null });
});

describe("set up for my parent, from the phone", () => {
  it("records the setup, then sends the code from a stateless client", async () => {
    const result = await startProxySetup("Mama", "+2348012345678");
    expect(result).toEqual({ ok: true, data: { hours: 72 } });
    expect(mockRpc).toHaveBeenCalledWith("create_proxy_setup", { p_full_name: "Mama", p_phone: "+2348012345678", p_ttl_hours: 72, p_max_per_day: 5 });
    expect(mockOtp).toHaveBeenCalledWith({ phone: "+2348012345678", options: { shouldCreateUser: true } });
  });

  it("never reports success when no code went out", async () => {
    mockOtp.mockResolvedValue({ error: { message: "sms down" } });
    expect((await startProxySetup("Mama", "+2348012345678")).ok).toBe(false);
  });

  it("explains a cooling-off refusal and sends no code", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "proxy_setup_cooling_off" } });
    const result = await startProxySetup("Mama", "+2348012345678");
    expect(!result.ok && result.error).toMatch(/ended your access recently/i);
    expect(mockOtp).not.toHaveBeenCalled();
  });
});

describe("the parent's side", () => {
  it("reads pending requests as a first name and an expiry only", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "s1", requester_first_name: "Ada", expires_at: "2026-10-09T00:00:00Z" }], error: null });
    expect(await loadPendingProxySetups()).toEqual({ ok: true, data: [{ id: "s1", requesterFirstName: "Ada", expiresAt: "2026-10-09T00:00:00Z" }] });
  });

  it("confirms with only valid categories and never passes permissions of its own", async () => {
    await confirmProxySetup("s1", ["medications", "not_a_category" as never]);
    expect(mockRpc).toHaveBeenCalledWith("confirm_proxy_setup", { p_setup_id: "s1", p_categories: ["medications"], p_permissions: [] });
  });

  it("shows who set it up and ends it with the proposed cooling-off", async () => {
    mockRpc.mockResolvedValue({ data: [{ grant_id: "g1", set_up_by: "Ada", since: "2026-10-01T00:00:00Z", categories: ["medications"] }], error: null });
    expect(await loadProxyArrangements()).toEqual([{ grantId: "g1", setUpBy: "Ada", since: "2026-10-01T00:00:00Z", categories: ["medications"] }]);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await endProxyAccess("g1")).toEqual({ ok: true, data: null });
    expect(mockRpc).toHaveBeenLastCalledWith("end_proxy_access", { p_grant: "g1", p_block_days: 30 });
  });
});

describe("hand-over at 18", () => {
  it("reads the state and treats a failed read as nothing pending", async () => {
    mockRpc.mockResolvedValue({ data: { pending: true, guardians: [{ id: "g1", first_name: "Ada" }] }, error: null });
    expect(await loadMyHandover()).toEqual({ pending: true, guardians: [{ id: "g1", firstName: "Ada" }] });
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await loadMyHandover()).toEqual({ pending: false, guardians: [] });
  });

  it("completes with exactly the guardians chosen, and an empty list ends everyone", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await completeHandover([]);
    expect(mockRpc).toHaveBeenCalledWith("complete_dependant_handover", { p_keep: [] });
    mockRpc.mockResolvedValue({ data: null, error: { message: "handover_not_yet" } });
    expect((await completeHandover(["g1"])).ok).toBe(false);
  });
});
