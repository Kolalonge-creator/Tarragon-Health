/**
 * logVitalWithConnectionFallback (vitals-form.tsx) is the client-side half
 * of the network-resilience fix — the half actions.ts's own try/catch
 * cannot cover, because a fully offline device rejects the Server Action's
 * invocation before the request ever reaches the server at all. Confirmed
 * live in the browser (see docs/OFFLINE_RESILIENCE_AUDIT.md) that, without
 * this wrapper, that rejection crashes the whole dashboard route segment
 * via error.tsx. This proves the wrapper turns that rejection into the same
 * friendly, retryable { error } shape actions.ts's own catch returns,
 * without needing a full browser/Next-router harness to exercise it.
 */

jest.mock("./actions", () => ({
  logVital: jest.fn(),
}));

import { logVital } from "./actions";
import { logVitalWithConnectionFallback } from "./vitals-form";

const mockedLogVital = logVital as jest.MockedFunction<typeof logVital>;

describe("logVitalWithConnectionFallback", () => {
  beforeEach(() => {
    mockedLogVital.mockReset();
  });

  it("resolves to a retryable error instead of rejecting when logVital's own invocation rejects", async () => {
    mockedLogVital.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await logVitalWithConnectionFallback(undefined, new FormData());

    expect(result?.error).toMatch(/check your connection/i);
    expect(result?.success).toBeUndefined();
  });

  it("passes a normal resolved result straight through unchanged", async () => {
    mockedLogVital.mockResolvedValue({ success: true });

    const result = await logVitalWithConnectionFallback(undefined, new FormData());

    expect(result).toEqual({ success: true });
  });

  it("sabotage check: a rejection isn't silently converted to success", async () => {
    mockedLogVital.mockRejectedValue(new Error("network down"));

    const result = await logVitalWithConnectionFallback(undefined, new FormData());

    expect(result?.success).not.toBe(true);
    expect(result?.error).toBeTruthy();
  });
});
