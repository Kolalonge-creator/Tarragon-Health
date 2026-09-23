/** @jest-environment jsdom */
import { describe, expect, it } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import { useRemountOnActionResult } from "./use-remount-on-action-result";

/**
 * Direct unit test for the shared hook — CLAUDE.md requires a Jest test for
 * every service function, and until now this was only exercised indirectly
 * through the signup/patient-location/risk-assessment forms' own
 * integration tests, so a regression in the hook itself (e.g. the
 * remount-gate or focus-restore logic) had no test that would catch it at
 * the source, separate from any one form's own quirks.
 */
describe("useRemountOnActionResult", () => {
  it("starts at attempt 0 and does not bump on the initial render", () => {
    const { result } = renderHook(() =>
      useRemountOnActionResult(undefined, () => true, "some-id")
    );
    expect(result.current).toBe(0);
  });

  it("bumps attempt when a new action result arrives and shouldRemount says yes", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: { error?: string } | undefined }) =>
        useRemountOnActionResult(state, (s) => Boolean(s?.error), "error-id"),
      { initialProps: { state: undefined as { error?: string } | undefined } }
    );
    expect(result.current).toBe(0);

    rerender({ state: { error: "Something went wrong" } });
    expect(result.current).toBe(1);
  });

  it("does not bump when a new action result arrives but shouldRemount says no", () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: { success?: boolean; error?: string } | undefined }) =>
        useRemountOnActionResult(state, (s) => Boolean(s?.error), "error-id"),
      { initialProps: { state: undefined as { success?: boolean; error?: string } | undefined } }
    );

    rerender({ state: { success: true } });
    expect(result.current).toBe(0);
  });

  it("does not bump again on a re-render with the exact same state reference", () => {
    const errorState = { error: "Bad request" };
    const { result, rerender } = renderHook(
      ({ s }: { s: { error?: string } | undefined }) => useRemountOnActionResult(s, () => true, "error-id"),
      { initialProps: { s: undefined as { error?: string } | undefined } }
    );

    rerender({ s: errorState });
    expect(result.current).toBe(1);

    // Same reference, same render input - not a genuinely new action result
    // (e.g. an unrelated parent re-render that doesn't touch `state` at all).
    rerender({ s: errorState });
    expect(result.current).toBe(1);
  });

  it("bumps again on a second, later action result", () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: { error?: string } | undefined }) =>
        useRemountOnActionResult(s, (state) => Boolean(state?.error), "error-id"),
      { initialProps: { s: undefined as { error?: string } | undefined } }
    );

    rerender({ s: { error: "First failure" } });
    expect(result.current).toBe(1);

    rerender({ s: { error: "Second failure" } });
    expect(result.current).toBe(2);
  });
});
