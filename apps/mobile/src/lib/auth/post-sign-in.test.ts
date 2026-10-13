import { runPostSignIn } from "./post-sign-in";
import type { RpcApi } from "./device-recognition";

const okRpc = { rpc: jest.fn(async () => ({ error: null })) } as unknown as RpcApi;
const failingRpc = {
  rpc: jest.fn(async () => {
    throw new Error("offline");
  }),
} as unknown as RpcApi;

describe("runPostSignIn", () => {
  it("records the device", async () => {
    const out = await runPostSignIn({ userId: "u1", rpc: okRpc });
    expect(out).toEqual({ deviceRecorded: true });
  });

  it("a device-record failure does not throw", async () => {
    const out = await runPostSignIn({ userId: "u1", rpc: failingRpc });
    expect(out).toEqual({ deviceRecorded: false });
  });
});
