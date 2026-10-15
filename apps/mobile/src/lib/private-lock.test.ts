jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock("expo-crypto", () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { deviceBiometric, controllerFor, secureStoreKey, secureStoreLockStorage } from "./private-lock";

describe("private lock on the device", () => {
  it("maps the controller's key to one SecureStore accepts (no colon), per account", () => {
    expect(secureStoreKey("private-section-lock-v1:1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed")).toBe("private-section-lock-v1.1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed");
    expect(secureStoreKey("a:b")).not.toBe(secureStoreKey("a:c"));
    expect(/^[A-Za-z0-9._-]+$/.test(secureStoreKey("private-section-lock-v1:x y/z"))).toBe(true);
  });

  it("reads and writes through the keystore under the mapped key, and an unreadable keystore reads as empty", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("v");
    expect(await secureStoreLockStorage.get("p:1")).toBe("v");
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith("p.1");
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("keystore"));
    expect(await secureStoreLockStorage.get("p:1")).toBeNull();
    await secureStoreLockStorage.set("p:1", "x");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("p.1", "x");
    await secureStoreLockStorage.remove("p:1");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("p.1");
  });

  it("biometric is unavailable with no enrolment, and a thrown prompt is 'unavailable', never a pass", async () => {
    (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(0);
    expect(await deviceBiometric.isAvailable()).toBe(false);
    (LocalAuthentication.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(2);
    expect(await deviceBiometric.isAvailable()).toBe(true);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });
    expect(await deviceBiometric.authenticate("x")).toBe("failed");
    (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValueOnce(new Error("no"));
    expect(await deviceBiometric.authenticate("x")).toBe("unavailable");
  });

  it("one controller per account, so a shared phone never shares unlocked state", () => {
    expect(controllerFor("a")).toBe(controllerFor("a"));
    expect(controllerFor("a")).not.toBe(controllerFor("b"));
  });

  it("an end to end PIN set-up and unlock through the keystore adapter", async () => {
    const store = new Map<string, string>();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => store.get(k) ?? null);
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => void store.set(k, v));
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => void store.delete(k));
    const c = controllerFor("acct-e2e");
    expect(await c.status()).toBe("needs_setup");
    expect((await c.setupPin("7391")).ok).toBe(true);
    c.lock();
    expect((await c.unlockWithPin("0000")).ok).toBe(false);
    expect((await c.unlockWithPin("7391")).ok).toBe(true);
    expect([...store.keys()][0]).toMatch(/^private-section-lock-v1\./);
  });
});
