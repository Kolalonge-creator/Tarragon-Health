/** @jest-environment jsdom */
/**
 * useOnlineStatus() is the whole basis for OfflineBanner (and anything else
 * that reacts to connectivity). Proves it picks up the real navigator.onLine
 * value after mount (not just its own hardcoded initial state) and reacts to
 * both the "offline" and "online" window events.
 */
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "./use-online-status";

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("useOnlineStatus", () => {
  afterEach(() => {
    setNavigatorOnLine(true);
  });

  it("picks up navigator.onLine = false on mount", async () => {
    setNavigatorOnLine(false);

    const { result } = renderHook(() => useOnlineStatus());
    // The hook reads navigator.onLine from a microtask (see its own comment
    // on why — avoiding a synchronous setState-in-effect lint violation), so
    // give it one tick to run before asserting the mount-time value.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe(false);
  });

  it("flips to false when the window fires 'offline', and back on 'online'", async () => {
    setNavigatorOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });
});
