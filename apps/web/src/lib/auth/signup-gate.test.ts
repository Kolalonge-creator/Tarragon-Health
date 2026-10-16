const rpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { checkSignupGate, isInviteOnlySignup } from "./signup-gate";

beforeEach(() => rpc.mockReset());

describe("checkSignupGate", () => {
  it("is open and asks nothing more while the switch is off", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await checkSignupGate({ email: "a@b.co" })).toEqual({ inviteOnly: false, allowed: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("follows the database answer when the switch is on", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await checkSignupGate({ email: "a@b.co", inviteCode: "X" })).toEqual({ inviteOnly: true, allowed: false });
    expect(rpc).toHaveBeenLastCalledWith("signup_gate_status", { p_phone: null, p_email: "a@b.co", p_invite_code: "X" });
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: true, error: null });
    expect(await checkSignupGate({ phone: "+2348011112222" })).toEqual({ inviteOnly: true, allowed: true });
  });

  it("never blocks on a failed pre-check: the database trigger is the real gate", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await checkSignupGate({ email: "a@b.co" })).toEqual({ inviteOnly: true, allowed: true });
    rpc.mockReset();
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await checkSignupGate({ email: "a@b.co" })).toEqual({ inviteOnly: false, allowed: true });
  });
});

describe("isInviteOnlySignup", () => {
  it("is true only when the switch answers true, and false on any failure", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await isInviteOnlySignup()).toBe(true);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await isInviteOnlySignup()).toBe(false);
    rpc.mockRejectedValueOnce(new Error("n"));
    expect(await isInviteOnlySignup()).toBe(false);
  });
});
