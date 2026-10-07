/** @jest-environment jsdom */
/**
 * ConsentNudgeBanner must show only when there is at least one outstanding
 * consent type, must disappear once dismissed for the rest of the browser
 * session (sessionStorage, same convention as MfaNudgeBanner), and must
 * never claim to know about consent status while still loading.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { ConsentNudgeBanner } from "./consent-nudge-banner";

const mockUseOutstandingConsentTypes = jest.fn();
jest.mock("@/lib/queries/consent", () => ({
  useOutstandingConsentTypes: (...args: unknown[]) => mockUseOutstandingConsentTypes(...args),
}));

describe("ConsentNudgeBanner", () => {
  beforeEach(() => {
    mockUseOutstandingConsentTypes.mockReset();
    window.sessionStorage.clear();
  });

  it("renders nothing while consent status is still loading", () => {
    mockUseOutstandingConsentTypes.mockReturnValue({ outstanding: [], isLoading: true });
    render(<ConsentNudgeBanner patientId="patient-1" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing when there is nothing outstanding", () => {
    mockUseOutstandingConsentTypes.mockReturnValue({ outstanding: [], isLoading: false });
    render(<ConsentNudgeBanner patientId="patient-1" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the nudge, with a link to /patient/privacy, when a consent type is outstanding", () => {
    mockUseOutstandingConsentTypes.mockReturnValue({
      outstanding: [{ id: "v1", consent_type: "data_processing", version: 2 }],
      isLoading: false,
    });
    render(<ConsentNudgeBanner patientId="patient-1" />);
    expect(screen.getByRole("status")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Review and accept" }).getAttribute("href")).toBe(
      "/patient/privacy"
    );
  });

  it("stays dismissed for the session once the dismiss button is clicked", () => {
    mockUseOutstandingConsentTypes.mockReturnValue({
      outstanding: [{ id: "v1", consent_type: "data_processing", version: 2 }],
      isLoading: false,
    });
    const { unmount } = render(<ConsentNudgeBanner patientId="patient-1" />);
    expect(screen.getByRole("status")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();

    // Simulated re-mount (e.g. navigating to another dashboard page) must
    // stay dismissed for the rest of this browser session.
    unmount();
    render(<ConsentNudgeBanner patientId="patient-1" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
