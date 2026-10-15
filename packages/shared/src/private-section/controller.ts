import { constantTimeEqual, fromHex, pbkdf2Sha256, toHex, utf8 } from "./pbkdf2";
import { pinProblem, type PinProblem } from "./pin";

/**
 * The private section lock (S66, decisions A14 and "section PIN optional and on by default with re-verification recovery").
 *
 * One controller, two thin front ends (web and mobile), so the rules are written and tested once:
 *  - It guards a VIEW on this device. It is separate from the whole-app biometric lock (apps/mobile/src/lib/app-lock.ts), which is left
 *    exactly as it is. Nothing here changes what the server holds, so a forgotten PIN costs the person nothing but a phone code.
 *  - ON BY DEFAULT: with no saved choice the section asks the person to set a PIN or biometric, or to turn the lock off on purpose. A
 *    deliberate "no lock" is remembered and not asked again.
 *  - The PIN is hashed with PBKDF2-HMAC-SHA256 and a random salt; only the hash is stored, in the device keystore (SecureStore on mobile,
 *    localStorage on web). The record is keyed by account, so two people sharing a phone never share a PIN.
 *  - Wrong tries are counted and persisted, and after the free tries each wrong try locks the PIN for a longer time. Restarting the
 *    app does not reset the count.
 *  - Re-asked after backgrounding: leaving the app (or hiding the tab) for longer than `relockAfterBackgroundSeconds` locks it again.
 *  - Recovery is account re-verification (a code to the account's own phone). The front end proves that with the auth provider and then
 *    calls `resetAfterReverification()`, which deletes only the local record. No server data is involved or lost.
 *  - Emergency and danger-sign content is NEVER put inside the lock: the front ends render it through the `outside` slot.
 *
 * Pure of platform code: storage, biometrics, the clock and the random source are injected.
 */

export interface LockStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface BiometricAdapter {
  isAvailable(): Promise<boolean>;
  authenticate(prompt: string): Promise<"success" | "failed" | "unavailable">;
}

export interface PrivateLockConfig {
  readonly pinMinDigits: number;
  readonly pinMaxDigits: number;
  readonly freeAttempts: number;
  /** Lockout after each wrong try beyond the free ones; the last value repeats. */
  readonly lockoutSeconds: readonly number[];
  readonly relockAfterBackgroundSeconds: number;
  readonly pbkdf2Iterations: number;
  readonly onByDefault: boolean;
}

export type LockMethod = "pin" | "biometric" | "pin_and_biometric";

interface StoredLockV1 {
  v: 1;
  enabled: boolean;
  method: LockMethod | null;
  saltHex: string | null;
  hashHex: string | null;
  iterations: number | null;
  failures: number;
  lockedUntilMs: number;
}

export type LockStatus = "needs_setup" | "locked" | "unlocked" | "disabled";

export type SetupResult = { ok: true } | { ok: false; reason: PinProblem | "biometric_unavailable" | "storage_failed" };

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: "wrong_pin"; attemptsLeftBeforeLockout: number; retryAfterSeconds: 0 }
  | { ok: false; reason: "locked_out"; retryAfterSeconds: number; attemptsLeftBeforeLockout: 0 }
  | { ok: false; reason: "no_pin_set" | "biometric_failed" | "biometric_unavailable"; retryAfterSeconds: 0; attemptsLeftBeforeLockout: 0 };

export interface PrivateLockDeps {
  readonly storage: LockStorage;
  readonly config: PrivateLockConfig;
  readonly now: () => number;
  /** n random bytes (crypto.getRandomValues on web, expo-crypto on mobile). */
  readonly randomBytes: (n: number) => Uint8Array;
  readonly biometric?: BiometricAdapter;
  /** The signed-in account. Keys the stored record so a shared phone keeps one PIN per account. */
  readonly accountId: string;
}

export const PRIVATE_LOCK_KEY_PREFIX = "private-section-lock-v1:";

export function privateLockKey(accountId: string): string {
  return `${PRIVATE_LOCK_KEY_PREFIX}${accountId}`;
}

export class PrivateLockController {
  private unlocked = false;
  private backgroundedAt: number | null = null;

  constructor(private readonly deps: PrivateLockDeps) {}

  private get key(): string {
    return privateLockKey(this.deps.accountId);
  }

  private async read(): Promise<StoredLockV1 | null> {
    let raw: string | null;
    try {
      raw = await this.deps.storage.get(this.key);
    } catch {
      // An unreadable keystore must not lock a person out of their own data, and must not silently open it either:
      // it is treated as "no record", which asks them to set up again (the data on the server is untouched).
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredLockV1>;
      if (parsed.v !== 1 || typeof parsed.enabled !== "boolean") return null;
      return {
        v: 1,
        enabled: parsed.enabled,
        method: parsed.method ?? null,
        saltHex: parsed.saltHex ?? null,
        hashHex: parsed.hashHex ?? null,
        iterations: parsed.iterations ?? null,
        failures: Number.isFinite(parsed.failures) ? (parsed.failures as number) : 0,
        lockedUntilMs: Number.isFinite(parsed.lockedUntilMs) ? (parsed.lockedUntilMs as number) : 0,
      };
    } catch {
      return null;
    }
  }

  private async write(record: StoredLockV1): Promise<boolean> {
    try {
      await this.deps.storage.set(this.key, JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<LockStatus> {
    const record = await this.read();
    if (!record) return this.deps.config.onByDefault ? "needs_setup" : "disabled";
    if (!record.enabled) return "disabled";
    if (this.unlocked) return "unlocked";
    return "locked";
  }

  /** The methods the unlock screen should offer. */
  async method(): Promise<LockMethod | null> {
    return (await this.read())?.method ?? null;
  }

  /** Seconds left on a wrong-PIN lockout, 0 when none. */
  async lockoutSecondsLeft(): Promise<number> {
    const record = await this.read();
    if (!record) return 0;
    return Math.max(0, Math.ceil((record.lockedUntilMs - this.deps.now()) / 1000));
  }

  async setupPin(pin: string, alsoBiometric = false): Promise<SetupResult> {
    const problem = pinProblem(pin, { minDigits: this.deps.config.pinMinDigits, maxDigits: this.deps.config.pinMaxDigits });
    if (problem) return { ok: false, reason: problem };
    if (alsoBiometric && !(await this.biometricReady())) return { ok: false, reason: "biometric_unavailable" };
    const salt = this.deps.randomBytes(16);
    const hash = pbkdf2Sha256(utf8(pin), salt, this.deps.config.pbkdf2Iterations);
    const ok = await this.write({
      v: 1,
      enabled: true,
      method: alsoBiometric ? "pin_and_biometric" : "pin",
      saltHex: toHex(salt),
      hashHex: toHex(hash),
      iterations: this.deps.config.pbkdf2Iterations,
      failures: 0,
      lockedUntilMs: 0,
    });
    if (!ok) return { ok: false, reason: "storage_failed" };
    this.unlocked = true;
    return { ok: true };
  }

  async setupBiometricOnly(): Promise<SetupResult> {
    if (!(await this.biometricReady())) return { ok: false, reason: "biometric_unavailable" };
    const result = await this.deps.biometric!.authenticate("Protect your private section");
    if (result !== "success") return { ok: false, reason: "biometric_unavailable" };
    const ok = await this.write({ v: 1, enabled: true, method: "biometric", saltHex: null, hashHex: null, iterations: null, failures: 0, lockedUntilMs: 0 });
    if (!ok) return { ok: false, reason: "storage_failed" };
    this.unlocked = true;
    return { ok: true };
  }

  /** A deliberate "no lock". Remembered, so the section does not ask again. Only allowed while unlocked or with no lock set. */
  async turnOff(): Promise<{ ok: boolean }> {
    const record = await this.read();
    if (record?.enabled && !this.unlocked) return { ok: false };
    const ok = await this.write({ v: 1, enabled: false, method: null, saltHex: null, hashHex: null, iterations: null, failures: 0, lockedUntilMs: 0 });
    this.unlocked = false;
    return { ok };
  }

  async unlockWithPin(pin: string): Promise<UnlockResult> {
    const record = await this.read();
    if (!record || !record.enabled || !record.hashHex || !record.saltHex || !record.iterations) {
      return { ok: false, reason: "no_pin_set", retryAfterSeconds: 0, attemptsLeftBeforeLockout: 0 };
    }
    const now = this.deps.now();
    if (record.lockedUntilMs > now) {
      return { ok: false, reason: "locked_out", retryAfterSeconds: Math.ceil((record.lockedUntilMs - now) / 1000), attemptsLeftBeforeLockout: 0 };
    }
    const candidate = toHex(pbkdf2Sha256(utf8(pin), fromHex(record.saltHex), record.iterations));
    if (constantTimeEqual(candidate, record.hashHex)) {
      await this.write({ ...record, failures: 0, lockedUntilMs: 0 });
      this.unlocked = true;
      return { ok: true };
    }
    const failures = record.failures + 1;
    const beyondFree = failures - this.deps.config.freeAttempts;
    const schedule = this.deps.config.lockoutSeconds;
    const lockoutSeconds = beyondFree >= 0 ? (schedule[Math.min(beyondFree, schedule.length - 1)] ?? 0) : 0;
    const lockedUntilMs = lockoutSeconds > 0 ? now + lockoutSeconds * 1000 : 0;
    await this.write({ ...record, failures, lockedUntilMs });
    if (lockoutSeconds > 0) return { ok: false, reason: "locked_out", retryAfterSeconds: lockoutSeconds, attemptsLeftBeforeLockout: 0 };
    return { ok: false, reason: "wrong_pin", attemptsLeftBeforeLockout: Math.max(0, this.deps.config.freeAttempts - failures), retryAfterSeconds: 0 };
  }

  async unlockWithBiometric(): Promise<UnlockResult> {
    const record = await this.read();
    if (!record || !record.enabled || (record.method !== "biometric" && record.method !== "pin_and_biometric")) {
      return { ok: false, reason: "no_pin_set", retryAfterSeconds: 0, attemptsLeftBeforeLockout: 0 };
    }
    if (!(await this.biometricReady())) return { ok: false, reason: "biometric_unavailable", retryAfterSeconds: 0, attemptsLeftBeforeLockout: 0 };
    const result = await this.deps.biometric!.authenticate("Open your private section");
    if (result === "success") {
      this.unlocked = true;
      return { ok: true };
    }
    return { ok: false, reason: result === "unavailable" ? "biometric_unavailable" : "biometric_failed", retryAfterSeconds: 0, attemptsLeftBeforeLockout: 0 };
  }

  lock(): void {
    this.unlocked = false;
  }

  /** The app or tab went to the background. */
  onBackgrounded(): void {
    this.backgroundedAt = this.deps.now();
  }

  /** The app or tab came back. Locks again when it was away longer than the configured time. */
  onForegrounded(): void {
    const left = this.backgroundedAt;
    this.backgroundedAt = null;
    if (left === null) return;
    if (this.deps.now() - left >= this.deps.config.relockAfterBackgroundSeconds * 1000) this.unlocked = false;
  }

  /**
   * The person proved control of the account's phone (the front end ran the code check). Deletes ONLY the local record, so the section
   * asks for a new PIN. Nothing on the server is read, changed or deleted.
   */
  async resetAfterReverification(): Promise<{ ok: boolean }> {
    try {
      await this.deps.storage.remove(this.key);
    } catch {
      return { ok: false };
    }
    this.unlocked = false;
    return { ok: true };
  }

  private async biometricReady(): Promise<boolean> {
    if (!this.deps.biometric) return false;
    try {
      return await this.deps.biometric.isAvailable();
    } catch {
      return false;
    }
  }
}
