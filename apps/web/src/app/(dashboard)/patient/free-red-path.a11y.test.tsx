/** @jest-environment jsdom */
/**
 * Two-tier Free red-event path (CMO 2026-10-08), the patient screens: the emergency dialog says in plain words that no doctor was
 * alerted and offers Membership without ever removing the acknowledge button, and the check-in card stores an answer. Both pass axe.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { EmergencyAlert } from "./emergency-alert";
import { FreeRedCheckin } from "./free-red-checkin";
import { FreeGuidance } from "./free-guidance";

const mockEmergency = jest.fn();
jest.mock("@/lib/queries/emergency", () => ({
  useActiveEmergency: () => ({ data: mockEmergency() }),
  activeEmergencyKey: (id: string) => ["active-emergency", id],
}));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("./actions", () => ({
  acknowledgeEmergency: jest.fn(async () => ({})),
  alertEmergencyContactNow: jest.fn(async () => ({})),
}));

const mockGuidance = jest.fn();
const mockAck = jest.fn();
const mockCheckin = jest.fn();
const mockMutate = jest.fn();
jest.mock("@/lib/queries/free-red-checkin", () => ({
  FREE_RED_CHECKIN_ANSWERS: ["got_care", "going_now", "not_yet"],
  useFreeRedCheckin: () => ({ data: mockCheckin() }),
  useFreeGuidance: () => ({ data: mockGuidance() }),
  useAcknowledgeFreeGuidance: () => ({ mutate: mockAck, isPending: false }),
  useAnswerFreeRedCheckin: () => ({ mutate: mockMutate, isPending: false, isError: false }),
}));

const baseEvent = { id: "e1", source: "triage_red", trigger_detail: null, created_at: "2026-10-12T10:00:00Z", contact_notified_at: null };

describe("EmergencyAlert on the Free plan", () => {
  it("says no doctor was alerted, keeps the acknowledge button, and offers Membership and a hospital search", async () => {
    mockEmergency.mockReturnValue({ ...baseEvent, clinician_alert_id: null });
    const { container } = render(<EmergencyAlert patientId="p1" hasEmergencyContact />);
    expect(screen.getByText("A doctor has not been alerted, because you are on the Free plan. Doctor review is part of Membership.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join as a Member" }).getAttribute("href")).toBe("/patient/membership");
    expect(screen.getByRole("link", { name: /Find a hospital near you/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I'm getting help" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/care team has been told/i);
    await expectNoA11yViolations(<EmergencyAlert patientId="p1" hasEmergencyContact />);
  });

  it("shows no Free block when a doctor was alerted (a Member)", () => {
    mockEmergency.mockReturnValue({ ...baseEvent, clinician_alert_id: "alert-1" });
    render(<EmergencyAlert patientId="p1" hasEmergencyContact />);
    expect(screen.queryByTestId("free-red-block")).toBeNull();
    expect(screen.queryByRole("link", { name: "Join as a Member" })).toBeNull();
    expect(screen.getByText(/care team has been told/i)).toBeTruthy();
  });
});

describe("FreeRedCheckin", () => {
  it("renders nothing when no check-in is due", () => {
    mockCheckin.mockReturnValue(null);
    const { container } = render(<FreeRedCheckin patientId="p1" />);
    expect(container.innerHTML).toBe("");
  });

  it("asks whether the patient got care and stores the chosen answer", async () => {
    mockCheckin.mockReturnValue({ id: "c1" });
    mockMutate.mockImplementation((_input: unknown, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    render(<FreeRedCheckin patientId="p1" />);
    expect(screen.getByText("Earlier we asked you to get care. Were you able to?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    expect(mockMutate).toHaveBeenCalledWith({ id: "c1", answer: "not_yet" }, expect.anything());
    await waitFor(() => expect(screen.getByText(/nearest hospital now/)).toBeTruthy());
  });

  it("has no axe violations", async () => {
    mockCheckin.mockReturnValue({ id: "c1" });
    await expectNoA11yViolations(<FreeRedCheckin patientId="p1" />);
  });
});

describe("FreeGuidance (amber and heart failure on the Free plan)", () => {
  it("shows calm guidance, the no-doctor sentence and the Membership route for a heart-failure notice", async () => {
    mockGuidance.mockReturnValue({ id: "g1", kind: "heart_failure" });
    const { container } = render(<FreeGuidance patientId="p1" />);
    expect(container.textContent).toContain("Your weight has gone up quickly");
    expect(screen.getByText("A doctor has not been alerted, because you are on the Free plan. Doctor review is part of Membership.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join as a Member" }).getAttribute("href")).toBe("/patient/membership");
    expect(container.textContent).not.toMatch(/warning|danger|—/i);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(mockAck).toHaveBeenCalledWith("g1");
    await expectNoA11yViolations(<FreeGuidance patientId="p1" />);
  });

  it("uses the amber wording for an amber notice and renders nothing when there is none", () => {
    mockGuidance.mockReturnValue({ id: "g2", kind: "amber" });
    const { container, rerender } = render(<FreeGuidance patientId="p1" />);
    expect(container.textContent).toContain("above your target");
    mockGuidance.mockReturnValue(null);
    rerender(<FreeGuidance patientId="p1" />);
    expect(container.innerHTML).toBe("");
  });
});
