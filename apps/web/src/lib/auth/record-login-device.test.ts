jest.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => (key === "user-agent" ? "TestAgent/1.0" : null),
  }),
}));

jest.mock("@/lib/rate-limit", () => ({
  getClientIp: async () => "203.0.113.5",
}));

import { recordLoginDevice } from "./record-login-device";

describe("recordLoginDevice", () => {
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
});
