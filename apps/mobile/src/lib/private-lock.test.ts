jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock("expo-crypto", () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { appPinKey, deviceBiometric, controllerFor, lockAppPinForGate, secureStoreKey, secureStoreLockStorage } from "./private-lock";

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

  describe("the app PIN (scope 'app')", () => {
    const wire = () => {
      const store = new Map<string, string>();
      (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => store.get(k) ?? null);
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => void store.set(k, v));
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => void store.delete(k));
      return store;
    };

    it("maps the key to its own prefix, so it can never collide with the private section's record", () => {
      expect(appPinKey("private-section-lock-v1:abc")).toBe("app-lock-pin-v1:abc");
      expect(appPinKey("other:abc")).toBe("app-lock-pin-v1:other:abc");
      expect(secureStoreKey(appPinKey("private-section-lock-v1:abc"))).toBe("app-lock-pin-v1.abc");
    });

    it("is a different controller from the private one for the same account", () => {
      expect(controllerFor("acct-x", "app")).toBe(controllerFor("acct-x", "app"));
      expect(controllerFor("acct-x", "app")).not.toBe(controllerFor("acct-x"));
    });

    it("is OFF until the person turns it on (the private section is on by default; the app lock must not trap anyone)", async () => {
      wire();
      expect(await controllerFor("acct-fresh", "app").status()).toBe("disabled");
      expect(await controllerFor("acct-fresh").status()).toBe("needs_setup");
    });

    it("a PIN set for the app is stored under its own key, locks the app, and a wrong PIN does not open it", async () => {
      const store = wire();
      const c = controllerFor("acct-app", "app");
      expect((await c.setupPin("4826")).ok).toBe(true);
      expect([...store.keys()].every((k) => k.startsWith("app-lock-pin-v1."))).toBe(true);
      c.lock();
      expect(await c.status()).toBe("locked");
      expect((await c.unlockWithPin("1111")).ok).toBe(false);
      expect(await c.status()).toBe("locked");
      expect((await c.unlockWithPin("4826")).ok).toBe(true);
      expect(await c.status()).toBe("unlocked");
    });

    it("has no biometric path: the OS prompt falls back to the phone's passcode, which is exactly what an app PIN must not accept", async () => {
      wire();
      const c = controllerFor("acct-nobio", "app");
      await c.setupPin("4826");
      c.lock();
      const r = await c.unlockWithBiometric();
      expect(r.ok).toBe(false);
      expect(await c.status()).toBe("locked");
    });

    it("the app PIN and the private PIN are independent: setting one does not set or open the other", async () => {
      wire();
      const app = controllerFor("acct-both", "app");
      const priv = controllerFor("acct-both");
      await app.setupPin("4826");
      expect(await priv.status()).toBe("needs_setup");
      await priv.setupPin("9173");
      app.lock();
      priv.lock();
      expect((await app.unlockWithPin("9173")).ok).toBe(false);
      expect((await priv.unlockWithPin("4826")).ok).toBe(false);
      expect((await app.unlockWithPin("4826")).ok).toBe(true);
      expect(await priv.status()).toBe("locked");
    });

    it("REGRESSION: after the PIN has been entered once, the lock screen re-locks it, so the PIN is asked for every time and not only on a cold start", async () => {
      wire();
      const c = controllerFor("acct-gate", "app");
      await c.setupPin("4826");
      c.lock();
      expect((await c.unlockWithPin("4826")).ok).toBe(true);
      // The first lock screen unmounted; nothing listens for the background any more, so the controller is still unlocked in memory.
      expect(await c.status()).toBe("unlocked");
      // The app locks again (returned from background): the lock screen mounts and re-locks before reading the state.
      lockAppPinForGate("acct-gate");
      expect(await c.status()).toBe("locked");
      expect((await c.unlockWithPin("0000")).ok).toBe(false);
      expect((await c.unlockWithPin("4826")).ok).toBe(true);
    });

    it("re-locking for the gate does nothing to an account with no app PIN, and never touches the private section's lock", async () => {
      wire();
      const none = controllerFor("acct-nopin", "app");
      lockAppPinForGate("acct-nopin");
      expect(await none.status()).toBe("disabled");
      const priv = controllerFor("acct-nopin");
      await priv.setupPin("9173");
      lockAppPinForGate("acct-nopin");
      expect(await priv.status()).toBe("unlocked");
    });

    it("locks out after repeated wrong tries, like the private lock", async () => {
      wire();
      const c = controllerFor("acct-lockout", "app");
      await c.setupPin("4826");
      c.lock();
      let last = await c.unlockWithPin("0000");
      for (let i = 0; i < 12 && !(last.ok === false && last.reason === "locked_out"); i += 1) last = await c.unlockWithPin("0000");
      expect(last.ok === false && last.reason === "locked_out").toBe(true);
      expect((await c.unlockWithPin("4826")).ok).toBe(false);
    });
  });
});

