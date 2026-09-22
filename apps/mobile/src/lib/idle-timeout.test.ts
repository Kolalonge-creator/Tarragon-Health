import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";
import { IDLE_TIMEOUT_MS, checkIdleAndMaybeSignOut, isIdleExpired, stampActivity } from "./idle-timeout";

jest.mock("./supabase", () => ({ supabase: { auth: { signOut: jest.fn() } } }));

const mockSignOut = supabase.auth.signOut as jest.MockedFunction<typeof supabase.auth.signOut>;

const LAST_ACTIVITY_KEY = "idle-timeout-last-seen-v1";
const NOW = 1_000_000_000;

afterEach(async () => {
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync(LAST_ACTIVITY_KEY);
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
