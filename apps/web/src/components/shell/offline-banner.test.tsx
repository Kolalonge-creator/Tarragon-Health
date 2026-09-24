/** @jest-environment jsdom */
/**
 * OfflineBanner is the "at minimum a graceful offline, will retry state"
 * closing the silent-failure gap this audit found: before this, nothing in
 * apps/web told a patient/clinician their device had no connection at all.
 * Covers: hidden while online, shown (and accessible) while offline, and
 * that it reacts live to the browser's own connectivity events rather than
 * only reading navigator.onLine once at mount.
 */
import { act, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { OfflineBanner } from "./offline-banner";

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("OfflineBanner", () => {
  afterEach(() => {
    setNavigatorOnLine(true);
  });

  it("renders nothing while online", () => {
    setNavigatorOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByText("You're offline")).toBeNull();
  });

  it("shows an accessible, non-dismissible notice while offline", async () => {
    setNavigatorOnLine(false);
    await expectNoA11yViolations(<OfflineBanner />);
    expect(screen.getByText("You're offline")).toBeTruthy();
    // role="status" (not "alert") — connectivity dropping mid-session is
    // worth announcing politely, not interrupting the screen reader for.
    expect(screen.getByRole("status")).toBeTruthy();
    // Non-dismissible: no close/dismiss button, unlike MfaNudgeBanner.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("appears and disappears live as the browser's connectivity events fire", () => {
    setNavigatorOnLine(true);
    render(<OfflineBanner />);
    expect(screen.queryByText("You're offline")).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("You're offline")).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("You're offline")).toBeNull();
  });
});
