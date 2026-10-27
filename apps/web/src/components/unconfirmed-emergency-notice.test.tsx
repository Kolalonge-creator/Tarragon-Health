/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { activeWording } from "@tarragon/i18n";
import DashboardError from "@/app/(dashboard)/error";
import { EMERGENCY_MARKER_KEY } from "@/lib/vitals/emergency-marker";
import { OFFLINE_UNCONFIRMED_TITLE } from "@/lib/vitals/offline-emergency";

/**
 * A reading that asked for emergency guidance was sent and the request then failed outright, which drops the page into the dashboard error
 * screen (the form and its dialog are gone). The tab's note (code only) lets that screen still show the signed wording.
 */
function renderBoundary() {
  jest.spyOn(console, "error").mockImplementation(() => {});
  return render(<DashboardError error={Object.assign(new Error("Failed to fetch"), { digest: "d" })} unstable_retry={() => {}} />);
}

describe("the dashboard error screen after a failed emergency-graded submit", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it("shows the signed wording for the code in the note, and says the save is not confirmed", () => {
    window.sessionStorage.setItem(EMERGENCY_MARKER_KEY, JSON.stringify({ code: "EMG-001L" }));
    renderBoundary();
    const notice = screen.getByTestId("unconfirmed-emergency-notice");
    expect(notice.textContent).toContain(activeWording("EMG-001L").title);
    expect(notice.textContent).toContain(activeWording("EMG-001L").body);
    expect(notice.textContent).toContain(OFFLINE_UNCONFIRMED_TITLE);
  });

  it("shows nothing for every other visitor to the error screen (no note, or a note that is not a known code)", () => {
    renderBoundary();
    expect(screen.queryByTestId("unconfirmed-emergency-notice")).toBeNull();
    window.sessionStorage.setItem(EMERGENCY_MARKER_KEY, JSON.stringify({ code: "anything else" }));
    renderBoundary();
    expect(screen.queryByTestId("unconfirmed-emergency-notice")).toBeNull();
  });
});
