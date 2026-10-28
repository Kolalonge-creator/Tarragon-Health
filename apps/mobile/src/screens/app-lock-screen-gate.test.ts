import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The lock screen cannot be rendered in these tests, so this pins the one ordering that makes the app PIN hold: the screen re-locks the
 * PIN (lockAppPinForGate) in its first render, BEFORE the hook reads the PIN state, and it never starts the device prompt while a PIN is
 * the way in. Without the first, the PIN is asked for only on a cold start and every later lock falls back to the phone's passcode.
 */
const src = readFileSync(join(__dirname, "app-lock-screen.tsx"), "utf8");

describe("app lock screen and the app PIN", () => {
  it("re-locks the PIN before the hook reads its state", () => {
    const relock = src.indexOf("lockAppPinForGate(accountId)");
    const hook = src.indexOf('usePrivateLock(accountId, "app")');
    expect(relock).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(-1);
    expect(relock).toBeLessThan(hook);
  });

  it("does not start the device prompt while the PIN state is loading or a PIN is required", () => {
    expect(src).toMatch(/if \(inFlight\.current \|\| pinChecking \|\| pinRequired\) return;/);
  });

  it("shows no Unlock (device prompt) button when a PIN is required", () => {
    const pinBranch = src.indexOf("pinRequired ? (");
    const unlockButton = src.indexOf(">Unlock</Text>");
    expect(pinBranch).toBeGreaterThan(-1);
    // The Unlock button sits in the else branch of the pinRequired ternary, after it.
    expect(unlockButton).toBeGreaterThan(pinBranch);
  });
});
