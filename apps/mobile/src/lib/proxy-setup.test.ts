import { answerProxySetup, loadPendingProxySetups, startProxySetup, type RpcCall } from "./proxy-setup";

const PARENT = "+2348031234567";

function deps(over: { rpc?: RpcCall; sendCode?: jest.Mock } = {}) {
  const rpc: jest.Mock = jest.fn(async () => ({ data: "setup-id", error: null }));
  const sendCode = over.sendCode ?? jest.fn(async () => ({ error: null }));
  return { rpc: (over.rpc ?? rpc) as RpcCall, sendCode, rawRpc: rpc };
}

describe("startProxySetup", () => {
  it("records the setup with config-driven ttl and cap, then sends the code to the parent's number only", async () => {
    const d = deps();
    const out = await startProxySetup(d, { fullName: "  Ngozi Okoro ", phone: PARENT });
    expect(out).toEqual({ kind: "sent", hours: 72 });
    expect(d.rawRpc).toHaveBeenCalledWith("create_proxy_setup", {
      p_full_name: "Ngozi Okoro",
      p_phone: PARENT,
      p_ttl_hours: 72,
      p_max_per_day: 5,
    });
    expect(d.sendCode).toHaveBeenCalledTimes(1);
    expect(d.sendCode).toHaveBeenCalledWith(PARENT);
  });

  it("answers the same when the number has no account (OQ-52) and when a code is already on its way", async () => {
    const noAccount = deps({ sendCode: jest.fn(async () => ({ error: { message: "Signups not allowed for otp" } })) });
    expect(await startProxySetup(noAccount, { fullName: "Ngozi", phone: PARENT })).toEqual({ kind: "sent", hours: 72 });
    const throttled = deps({ sendCode: jest.fn(async () => ({ error: { message: "For security purposes, you can only request this after 40 seconds" } })) });
    expect(await startProxySetup(throttled, { fullName: "Ngozi", phone: PARENT })).toEqual({ kind: "sent", hours: 72 });
  });

  it("reports a code that could not be sent instead of pretending", async () => {
    const d = deps({ sendCode: jest.fn(async () => ({ error: { message: "sms provider unavailable" } })) });
    expect(await startProxySetup(d, { fullName: "Ngozi", phone: PARENT })).toEqual({ kind: "error", key: "proxy.setup.error.not_sent" });
  });

  it("creates nothing and sends nothing for a bad name or number", async () => {
    const d = deps();
    expect(await startProxySetup(d, { fullName: "   ", phone: PARENT })).toEqual({ kind: "error", key: "proxy.setup.error.invalid" });
    expect(await startProxySetup(d, { fullName: "Ngozi", phone: "08031234567" })).toEqual({ kind: "error", key: "proxy.setup.error.invalid" });
    expect(d.rawRpc).not.toHaveBeenCalled();
    expect(d.sendCode).not.toHaveBeenCalled();
  });

  it("sends no code when the setup was refused (own number, daily cap)", async () => {
    const own = deps({ rpc: (async () => ({ data: null, error: { message: "that is your own number" } })) as RpcCall });
    expect(await startProxySetup(own, { fullName: "Me", phone: PARENT })).toEqual({ kind: "error", key: "proxy.setup.error.own_number" });
    const capped = deps({ rpc: (async () => ({ data: null, error: { message: "proxy_setup_rate_limited" } })) as RpcCall });
    expect(await startProxySetup(capped, { fullName: "Ngozi", phone: PARENT })).toEqual({ kind: "error", key: "proxy.setup.error.rate_limited" });
    expect(own.sendCode).not.toHaveBeenCalled();
    expect(capped.sendCode).not.toHaveBeenCalled();
  });
});

describe("the parent's side", () => {
  it("a failed load is null, not an empty list", async () => {
    expect(await loadPendingProxySetups((async () => ({ data: null, error: { message: "boom" } })) as RpcCall)).toBeNull();
    expect(await loadPendingProxySetups((async () => ({ data: [], error: null })) as RpcCall)).toEqual([]);
  });

  it("confirming sends the setup id and categories only; declining sends the id only", async () => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    expect(await answerProxySetup(rpc as unknown as RpcCall, { setupId: "s1", categories: ["medications"], accept: true })).toBe(true);
    expect(rpc).toHaveBeenCalledWith("confirm_proxy_setup", { p_setup_id: "s1", p_categories: ["medications"], p_permissions: [] });
    expect(await answerProxySetup(rpc as unknown as RpcCall, { setupId: "s1", categories: [], accept: false })).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("decline_proxy_setup", { p_setup_id: "s1" });
  });

  it("reports a refusal", async () => {
    const rpc = (async () => ({ data: null, error: { message: "this setup cannot be confirmed" } })) as RpcCall;
    expect(await answerProxySetup(rpc, { setupId: "s1", categories: [], accept: true })).toBe(false);
  });
});
