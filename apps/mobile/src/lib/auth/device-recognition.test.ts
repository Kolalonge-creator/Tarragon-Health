import * as SecureStore from "expo-secure-store";
import { DEVICE_ID_KEY, deviceFingerprint, mobileUserAgent, recordLoginDevice, type RpcApi } from "./device-recognition";

describe("device fingerprint", () => {
  it("is a stable hash of a per-install id, never the raw id", async () => {
    const a = await deviceFingerprint();
    const b = await deviceFingerprint();
    const raw = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(raw).toBeTruthy();
    expect(a).not.toContain(raw as string);
  });

  it("uses a short, non-identifying user agent", () => {
    expect(mobileUserAgent()).toMatch(/^TarragonHealth-mobile\/(ios|android)$/);
  });
});

describe("recordLoginDevice", () => {
  it("calls record_login_device with the hashed fingerprint", async () => {
    const rpc = jest.fn(async () => ({ error: null }));
    const out = await recordLoginDevice({ rpc } as unknown as RpcApi);
    expect(out).toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_login_device", {
      p_device_fingerprint: await deviceFingerprint(),
      p_user_agent: mobileUserAgent(),
      p_ip: "unknown",
    });
  });

  it("an RPC error does not throw", async () => {
    const rpc = jest.fn(async () => ({ error: { message: "nope" } }));
    expect(await recordLoginDevice({ rpc } as unknown as RpcApi)).toBe(false);
  });

  it("a thrown failure (offline) does not block sign-in", async () => {
    const rpc = jest.fn(async () => {
      throw new Error("network");
    });
    await expect(recordLoginDevice({ rpc } as unknown as RpcApi)).resolves.toBe(false);
  });
});
