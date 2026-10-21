/** @jest-environment jsdom */
/**
 * The glucose profile beside a message thread. The point of the disclosure is that the audited read is made on purpose: nothing is read until a
 * clinician opens it, and opening it on a patient with no sensor says so.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { AgpDisclosure } from "./agp-disclosure";
import { AgpReadError } from "@/lib/cgm/agp-read";
import { FIXTURE_NOW, fortnight } from "@/lib/cgm/fixtures/agp-fortnight";

const mockReadings = jest.fn();
jest.mock("@/lib/queries/cgm", () => ({ useAgpReadings: (id: string) => mockReadings(id) }));
jest.mock("@/components/glucose-unit-provider", () => ({ useGlucoseUnit: () => "mmol_l" }));

beforeEach(() => mockReadings.mockReset());

describe("AgpDisclosure", () => {
  it("makes no read and shows no profile until it is opened", () => {
    mockReadings.mockReturnValue({ data: { samples: fortnight(), fetchedAt: FIXTURE_NOW, truncated: false }, isLoading: false, isError: false });
    render(<AgpDisclosure patientId="p1" />);
    expect(mockReadings).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
    const button = screen.getByRole("button", { name: /show sensor glucose profile/i });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("reads for that patient and shows the clinician profile once opened, and closes again", () => {
    mockReadings.mockReturnValue({ data: { samples: fortnight(), fetchedAt: FIXTURE_NOW, truncated: false }, isLoading: false, isError: false });
    render(<AgpDisclosure patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /show sensor glucose profile/i }));
    expect(mockReadings).toHaveBeenCalledWith("p1");
    expect(screen.getByRole("img", { name: /glucose profile over a day/i })).toBeTruthy();
    expect(screen.getByText("Glucose management indicator")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /hide sensor glucose profile/i }));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("says so when the patient has no sensor glucose, instead of showing nothing", () => {
    mockReadings.mockReturnValue({ data: { samples: [], fetchedAt: FIXTURE_NOW, truncated: false }, isLoading: false, isError: false });
    render(<AgpDisclosure patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /show sensor glucose profile/i }));
    expect(screen.getByRole("status").textContent).toContain("No sensor glucose in the last 14 days");
  });

  it("says it is loading, and says not available (never no readings) when the read is refused", () => {
    mockReadings.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { unmount } = render(<AgpDisclosure patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /show sensor glucose profile/i }));
    expect(screen.getByRole("status").textContent).toContain("Loading");
    unmount();
    mockReadings.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new AgpReadError("denied", "x") });
    render(<AgpDisclosure patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /show sensor glucose profile/i }));
    expect(screen.getByRole("status").textContent).toContain("not available to you");
  });
});
