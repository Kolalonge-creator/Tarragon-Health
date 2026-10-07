/**
 * assertNotActingFor must default to "not acting" when getActingFor()
 * rejects, matching home-shell.tsx's own best-effort convention for the
 * same underlying call ("a failed read (e.g. SecureStore hiccup) falls
 * back to the device owner's own account rather than crashing with an
 * unhandled rejection"). Without this, a SecureStore keychain/keystore
 * failure would propagate as an unhandled rejection out of
 * assertNotActingFor's mobile callers (e.g. womens-health.ts's
 * setLastMenstrualPeriod/recordDelivery/logPostnatalCheckin), which have
 * no try/catch of their own and would be left with a stuck loading state
 * and no error shown — worse than the raw RLS error this guard exists to
 * avoid.
 */
import { assertNotActingFor } from "./acting";

jest.mock("./supabase", () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockRejectedValue(new Error("Keychain access error")),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe("assertNotActingFor", () => {
  it("resolves to null instead of rejecting when getActingFor() fails", async () => {
    await expect(assertNotActingFor("some message")).resolves.toBeNull();
  });
});
