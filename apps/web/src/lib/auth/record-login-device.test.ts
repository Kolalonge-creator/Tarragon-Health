const headersMock = jest.fn(async () => ({
  get: (key: string) => (key === "user-agent" ? "TestAgent/1.0" : null),
}));
jest.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

const getClientIpMock = jest.fn(async () => "203.0.113.5");
jest.mock("@/lib/rate-limit", () => ({
  getClientIp: () => getClientIpMock(),
}));

import { recordLoginDevice } from "./record-login-device";

describe("recordLoginDevice", () => {
  beforeEach(() => {
    headersMock.mockClear();
    headersMock.mockImplementation(async () => ({
      get: (key: string) => (key === "user-agent" ? "TestAgent/1.0" : null),
    }));
    getClientIpMock.mockClear();
    getClientIpMock.mockImplementation(async () => "203.0.113.5");
  });

  it("calls the RPC with a sha256 fingerprint of the User-Agent, plus the UA and IP", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as unknown as Parameters<typeof recordLoginDevice>[0];

    await recordLoginDevice(supabase);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpc.mock.calls[0]!;
    expect(fnName).toBe("record_login_device");
    expect(args).toEqual({
      p_device_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      p_user_agent: "TestAgent/1.0",
      p_ip: "203.0.113.5",
    });
  });

  it("never throws when the RPC call itself throws", async () => {
    const rpc = jest.fn().mockRejectedValue(new Error("network down"));
    const supabase = { rpc } as unknown as Parameters<typeof recordLoginDevice>[0];

    await expect(recordLoginDevice(supabase)).resolves.toBeUndefined();
  });

  it("never throws when the RPC resolves with a PostgREST-level error (regression: this used to be silently ignored)", async () => {
    // callRpc's job (lockout-rpc.ts) is to catch exactly this shape — a
    // lost EXECUTE grant on record_login_device resolves {data:null,
    // error:...} rather than throwing, which the old bare try/catch never
    // inspected at all.
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "permission denied for function record_login_device" },
    });
    const supabase = { rpc } as unknown as Parameters<typeof recordLoginDevice>[0];

    await expect(recordLoginDevice(supabase)).resolves.toBeUndefined();
  });

  // Regression: after routing the RPC call through callRpc, only the RPC
  // call itself was protected by a try/catch — headers()/getClientIp()/
  // createHash() ran unguarded before it, contradicting this function's own
  // "must never block a real login" doc-comment promise. Flagged
  // independently 4+ times across review passes. Fixed by wrapping the
  // whole function body in one try/catch again.
  it("never throws when headers() itself throws (no request context)", async () => {
    headersMock.mockRejectedValueOnce(new Error("no request context"));
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as unknown as Parameters<typeof recordLoginDevice>[0];

    await expect(recordLoginDevice(supabase)).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws when getClientIp() itself throws", async () => {
    getClientIpMock.mockRejectedValueOnce(new Error("malformed forwarded-for header"));
    const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as unknown as Parameters<typeof recordLoginDevice>[0];

    await expect(recordLoginDevice(supabase)).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
