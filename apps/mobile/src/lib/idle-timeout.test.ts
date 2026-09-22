import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";
import {
  IDLE_TIMEOUT_MS,
  __resetThrottleForTests,
  checkIdleAndMaybeSignOut,
  isIdleExpired,
  stampActivity,
} from "./idle-timeout";

jest.mock("./supabase", () => ({ supabase: { auth: { signOut: jest.fn() } } }));

const mockSignOut = supabase.auth.signOut as jest.MockedFunction<typeof supabase.auth.signOut>;

const LAST_ACTIVITY_KEY = "idle-timeout-last-seen-v1";
const NOW = 1_000_000_000;

afterEach(async () => {
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync(LAST_ACTIVITY_KEY);
  // Each test below passes its own explicit (and, across independent test
  // cases, often non-monotonic) timestamps — without this, stampActivity's
  // real in-app write-throttle would silently no-op a later test's call
  // because it looks "too soon" after an earlier, unrelated test's stamp.
  __resetThrottleForTests();
});

describe("isIdleExpired", () => {
  it("is not idle when never stamped (null) — the normal shape right after a fresh sign-in", () => {
    expect(isIdleExpired(null, NOW)).toBe(false);
  });

  it("is not idle just under the threshold", () => {
    expect(isIdleExpired(NOW - (IDLE_TIMEOUT_MS - 1000), NOW)).toBe(false);
  });

  it("is idle once strictly past the threshold", () => {
    expect(isIdleExpired(NOW - (IDLE_TIMEOUT_MS + 1000), NOW)).toBe(true);
  });
});

describe("stampActivity throttle", () => {
  it("skips a write within the throttle window of the previous stamp", async () => {
    await stampActivity(NOW);
    await stampActivity(NOW + 1000); // well inside the 10s throttle window
    // The throttled write must not have landed — the stored value is still
    // the first stamp, not the second.
    expect(await SecureStore.getItemAsync(LAST_ACTIVITY_KEY)).toBe(String(NOW));
  });

  it("writes again once the throttle window has passed", async () => {
    await stampActivity(NOW);
    await stampActivity(NOW + 11_000); // outside the 10s throttle window
    expect(await SecureStore.getItemAsync(LAST_ACTIVITY_KEY)).toBe(String(NOW + 11_000));
  });
});

describe("checkIdleAndMaybeSignOut", () => {
  it("does nothing when nothing has ever been stamped", async () => {
    const signedOut = await checkIdleAndMaybeSignOut(NOW);
    expect(signedOut).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("does nothing when the last activity is within the threshold", async () => {
    await stampActivity(NOW - 60_000);
    const signedOut = await checkIdleAndMaybeSignOut(NOW);
    expect(signedOut).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("signs out and clears the stamp once idle-expired", async () => {
    await stampActivity(NOW - (IDLE_TIMEOUT_MS + 60_000));
    const signedOut = await checkIdleAndMaybeSignOut(NOW);
    expect(signedOut).toBe(true);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(await SecureStore.getItemAsync(LAST_ACTIVITY_KEY)).toBeNull();
  });

  it("swallows a signOut() failure rather than throwing — a caller inside an AppState listener or setInterval tick has nowhere useful to surface it", async () => {
    mockSignOut.mockRejectedValueOnce(new Error("network down"));
    await stampActivity(NOW - (IDLE_TIMEOUT_MS + 60_000));
    await expect(checkIdleAndMaybeSignOut(NOW)).resolves.toBe(false);
  });

  it("a fresh stampActivity after an idle-expiring gap resets the clock — proves the gate re-opens on real activity, not just that it closes", async () => {
    await stampActivity(NOW - (IDLE_TIMEOUT_MS + 60_000));
    await stampActivity(NOW); // a real touch right before the check
    const signedOut = await checkIdleAndMaybeSignOut(NOW);
    expect(signedOut).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
