/**
 * isConnectivityError is what lets the shared (dashboard)/error.tsx boundary
 * (see error-connectivity-detection.test.ts) show a distinct "connection
 * lost" message instead of the generic "Oops" fallback for the ~113
 * useActionState call sites docs/OFFLINE_RESILIENCE_AUDIT.md §4 flags as not
 * individually hardened. Covers both connectivity-shaped cases named in the
 * task brief (a browser fetch() failure, and Next's own deployment-rotation
 * "Failed to find Server Action" error), and proves ordinary bugs are NOT
 * misclassified as connectivity errors, which would hide a real defect
 * behind reassuring "nothing was lost, just try again" copy.
 */
import { isConnectivityError } from "./is-connectivity-error";

describe("isConnectivityError", () => {
  it.each([
    ["Chrome/Edge", "Failed to fetch"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["Safari", "Load failed"],
    ["Safari, connection dropped mid-request", "The network connection was lost."],
    ["Safari, airplane mode", "The Internet connection appears to be offline."],
    ["Node/undici (a Server Action's own server-to-Supabase call)", "fetch failed"],
  ])("treats a %s fetch-failure TypeError as a connectivity error", (_engine, message) => {
    expect(isConnectivityError(new TypeError(message))).toBe(true);
  });

  it("is case-insensitive on the message match", () => {
    expect(isConnectivityError(new TypeError("FAILED TO FETCH"))).toBe(true);
  });

  it("treats a deployment-rotation 'Server Action not found' error as a connectivity error", () => {
    // isConnectivityError delegates this case to Next's own
    // unstable_isUnrecognizedActionError, which does a real `instanceof`
    // check against its internal error class — a lookalike class with a
    // matching `name` would NOT satisfy it, so this constructs a genuine
    // instance of the class Next's client router actually throws (see
    // node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js)
    // rather than a hand-rolled stand-in that could pass for the wrong
    // reason.
    const { UnrecognizedActionError } = jest.requireActual<
      typeof import("next/dist/client/components/unrecognized-action-error")
    >("next/dist/client/components/unrecognized-action-error");
    const error = new UnrecognizedActionError(
      'Server Action "abc123" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'
    );
    expect(isConnectivityError(error)).toBe(true);
  });

  it("treats a reached-but-unrecognised server response as a connectivity error", () => {
    // Next throws this exact literal (server-action-reducer.js, error code
    // E394) as a plain Error, not a TypeError, when a Server Action's
    // response is neither valid RSC content nor a redirect — the server WAS
    // reached, but responded with something else (a gateway/outage page).
    const error = new Error("An unexpected response was received from the server.");
    expect(isConnectivityError(error)).toBe(true);
  });

  it("does not treat a bare TypeError from a real bug as a connectivity error", () => {
    expect(isConnectivityError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(
      false
    );
  });

  it("does not treat a non-TypeError exception as a connectivity error", () => {
    expect(isConnectivityError(new Error("Failed to fetch"))).toBe(false);
  });

  it("does not treat a plain validation/domain error as a connectivity error", () => {
    expect(isConnectivityError(new Error("Reading out of range"))).toBe(false);
  });

  it("handles non-Error values reaching the boundary without throwing", () => {
    expect(isConnectivityError("boom")).toBe(false);
    expect(isConnectivityError(null)).toBe(false);
    expect(isConnectivityError(undefined)).toBe(false);
  });
});
