import { describe, expect, it } from "@jest/globals";
import { PrivateLockController, privateLockKey, type BiometricAdapter, type LockStorage, type PrivateLockConfig } from "./controller";
import { getPrivateLockConfig } from "./config";
import { pinProblem } from "./pin";

const CONFIG: PrivateLockConfig = {
  pinMinDigits: 4,
  pinMaxDigits: 6,
  freeAttempts: 3,
  lockoutSeconds: [30, 60],
  relockAfterBackgroundSeconds: 30,
  pbkdf2Iterations: 5, // tiny so the tests are fast; the algorithm itself is proven in pbkdf2.test.ts
  onByDefault: true,
};

function memoryStorage(): LockStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

function make(opts: { account?: string; storage?: LockStorage; bio?: BiometricAdapter; config?: PrivateLockConfig; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: 1_000_000 };
  const storage = opts.storage ?? memoryStorage();
  const c = new PrivateLockController({
    storage,
    config: opts.config ?? CONFIG,
    now: () => clock.t,
    randomBytes: (n) => new Uint8Array(n).map((_, i) => (i * 7 + 3) & 255),
    biometric: opts.bio,
    accountId: opts.account ?? "acct-1",
  });
  return { c, storage, clock };
}

describe("private section lock: default and setup", () => {
  it("is ON BY DEFAULT: with no saved choice it asks for a lock", async () => {
    expect(await make().c.status()).toBe("needs_setup");
  });

  it("a deliberate turn-off is remembered and not asked again", async () => {
    const { c, storage } = make();
    expect((await c.turnOff()).ok).toBe(true);
    expect(await c.status()).toBe("disabled");
    const again = new PrivateLockController({ storage, config: CONFIG, now: () => 0, randomBytes: () => new Uint8Array(16), accountId: "acct-1" });
    expect(await again.status()).toBe("disabled");
  });

  it("setting a PIN unlocks the section, stores only a hash and never the PIN", async () => {
    const { c, storage } = make();
    expect(await c.setupPin("7391")).toEqual({ ok: true });
    expect(await c.status()).toBe("unlocked");
    const stored = [...(storage as ReturnType<typeof memoryStorage>).data.values()].join("");
    expect(stored).not.toContain("7391");
    expect(stored).toContain("hashHex");
  });

  it("refuses weak and malformed PINs", async () => {
    const { c } = make();
    expect(await c.setupPin("12")).toEqual({ ok: false, reason: "too_short" });
    expect(await c.setupPin("1234567")).toEqual({ ok: false, reason: "too_long" });
    expect(await c.setupPin("1111")).toEqual({ ok: false, reason: "same_digit" });
    expect(await c.setupPin("2345")).toEqual({ ok: false, reason: "sequence" });
    expect(await c.setupPin("9876")).toEqual({ ok: false, reason: "sequence" });
    expect(await c.setupPin("2580")).toEqual({ ok: false, reason: "common" });
    expect(await c.setupPin("12a4")).toEqual({ ok: false, reason: "not_digits" });
    expect(await c.status()).toBe("needs_setup");
  });

  it("pinProblem agrees with the config bounds", () => {
    expect(pinProblem("7391", { minDigits: 4, maxDigits: 6 })).toBeNull();
    expect(pinProblem("739", { minDigits: 4, maxDigits: 6 })).toBe("too_short");
  });
});

describe("private section lock: unlock, wrong tries and lockout", () => {
  async function locked() {
    const ctx = make();
    await ctx.c.setupPin("7391");
    ctx.c.lock();
    return ctx;
  }

  it("the right PIN opens it, a wrong one does not", async () => {
    const { c } = await locked();
    expect(await c.status()).toBe("locked");
    expect((await c.unlockWithPin("1357")).ok).toBe(false);
    expect(await c.status()).toBe("locked");
    expect(await c.unlockWithPin("7391")).toEqual({ ok: true });
    expect(await c.status()).toBe("unlocked");
  });

  it("counts down the free tries, then locks out with a growing wait that survives a restart", async () => {
    const { c, storage, clock } = await locked();
    expect(await c.unlockWithPin("0001")).toMatchObject({ reason: "wrong_pin", attemptsLeftBeforeLockout: 2 });
    expect(await c.unlockWithPin("0002")).toMatchObject({ reason: "wrong_pin", attemptsLeftBeforeLockout: 1 });
    expect(await c.unlockWithPin("0003")).toMatchObject({ reason: "locked_out", retryAfterSeconds: 30 });
    // even the right PIN is refused while locked out
    expect(await c.unlockWithPin("7391")).toMatchObject({ reason: "locked_out" });
    // a restart (a new controller on the same storage) keeps the lockout
    const restarted = new PrivateLockController({ storage, config: CONFIG, now: () => clock.t, randomBytes: () => new Uint8Array(16), accountId: "acct-1" });
    expect(await restarted.unlockWithPin("7391")).toMatchObject({ reason: "locked_out" });
    clock.t += 31_000;
    expect(await c.unlockWithPin("0004")).toMatchObject({ reason: "locked_out", retryAfterSeconds: 60 });
    clock.t += 61_000;
    expect(await c.unlockWithPin("7391")).toEqual({ ok: true });
    // success clears the count
    c.lock();
    expect(await c.unlockWithPin("0001")).toMatchObject({ reason: "wrong_pin", attemptsLeftBeforeLockout: 2 });
  });

  it("two accounts on one phone keep separate PINs", async () => {
    const storage = memoryStorage();
    const a = make({ storage, account: "alice" });
    const b = make({ storage, account: "bola" });
    await a.c.setupPin("7391");
    expect(await b.c.status()).toBe("needs_setup");
    await b.c.setupPin("2468");
    a.c.lock();
    b.c.lock();
    expect((await a.c.unlockWithPin("2468")).ok).toBe(false);
    expect((await b.c.unlockWithPin("2468")).ok).toBe(true);
    expect(privateLockKey("alice")).not.toBe(privateLockKey("bola"));
  });

  it("turning the lock off needs the section to be unlocked first", async () => {
    const { c } = await locked();
    expect((await c.turnOff()).ok).toBe(false);
    await c.unlockWithPin("7391");
    expect((await c.turnOff()).ok).toBe(true);
    expect(await c.status()).toBe("disabled");
  });
});

describe("private section lock: backgrounding and recovery", () => {
  it("re-asks after the app was away longer than the configured time, not before", async () => {
    const { c, clock } = make();
    await c.setupPin("7391");
    c.onBackgrounded();
    clock.t += 10_000;
    c.onForegrounded();
    expect(await c.status()).toBe("unlocked");
    c.onBackgrounded();
    clock.t += 31_000;
    c.onForegrounded();
    expect(await c.status()).toBe("locked");
  });

  it("recovery deletes only the local record and asks for a new PIN", async () => {
    const { c, storage } = make();
    await c.setupPin("7391");
    c.lock();
    expect((await c.resetAfterReverification()).ok).toBe(true);
    expect((storage as ReturnType<typeof memoryStorage>).data.size).toBe(0);
    expect(await c.status()).toBe("needs_setup");
    expect(await c.setupPin("2468")).toEqual({ ok: true });
  });

  it("an unreadable keystore asks for setup again and never silently opens the section", async () => {
    const broken: LockStorage = { get: async () => { throw new Error("keystore"); }, set: async () => { throw new Error("keystore"); }, remove: async () => undefined };
    const { c } = make({ storage: broken });
    expect(await c.status()).toBe("needs_setup");
    expect(await c.setupPin("7391")).toEqual({ ok: false, reason: "storage_failed" });
    expect(await c.status()).toBe("needs_setup");
  });

  it("a corrupt record is treated as no record", async () => {
    const storage = memoryStorage();
    storage.data.set(privateLockKey("acct-1"), "{not json");
    expect(await make({ storage }).c.status()).toBe("needs_setup");
  });
});

describe("private section lock: biometric", () => {
  const bio = (result: "success" | "failed" | "unavailable", available = true): BiometricAdapter => ({ isAvailable: async () => available, authenticate: async () => result });

  it("biometric only: set up, lock, unlock, and a failed scan stays locked", async () => {
    const ok = make({ bio: bio("success") });
    expect(await ok.c.setupBiometricOnly()).toEqual({ ok: true });
    ok.c.lock();
    expect(await ok.c.unlockWithBiometric()).toEqual({ ok: true });
    const bad = make({ bio: bio("failed") });
    expect((await bad.c.setupBiometricOnly()).ok).toBe(false);
  });

  it("biometric is refused when the device has none, and PIN works as the fallback for pin_and_biometric", async () => {
    expect(await make({ bio: bio("success", false) }).c.setupBiometricOnly()).toEqual({ ok: false, reason: "biometric_unavailable" });
    const both = make({ bio: bio("failed") });
    expect(await both.c.setupPin("7391", true)).toEqual({ ok: true });
    both.c.lock();
    expect(await both.c.unlockWithBiometric()).toMatchObject({ ok: false, reason: "biometric_failed" });
    expect(await both.c.unlockWithPin("7391")).toEqual({ ok: true });
  });
});

describe("private section lock: PROPOSED config", () => {
  it("reads versioned config, on by default", () => {
    const cfg = getPrivateLockConfig();
    expect(cfg.onByDefault).toBe(true);
    expect(cfg.pinMinDigits).toBeLessThanOrEqual(cfg.pinMaxDigits);
    expect(cfg.lockoutSeconds.length).toBeGreaterThan(0);
  });
});
