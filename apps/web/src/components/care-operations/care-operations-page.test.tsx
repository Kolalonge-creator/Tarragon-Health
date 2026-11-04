/** @jest-environment jsdom */
/**
 * MSG-5: the care operations page. The data hook is stubbed; what is under test is that a failed read never renders as zeros, that the
 * message tiles open the right inbox view for the viewer's area, and that a coordinator gets no link into the doctor-only queues.
 */
import { render, screen } from "@testing-library/react";
import { CareOperationsPage } from "./care-operations-page";
import { parseCareOperationsSummary, type CareOperationsSummary } from "@/lib/queries/care-operations";

const mockHook = jest.fn();
jest.mock("@/lib/queries/care-operations", () => {
  const actual = jest.requireActual("@/lib/queries/care-operations");
  return { ...actual, useCareOperationsSummary: () => mockHook() };
});

const DATA: CareOperationsSummary = {
  messages: { new_today: 5, support_waiting: 3, clinical_waiting: 1, needs_doctor: 1, past_target: 2, older_unanswered: 1, unowned_waiting: 0 },
  alerts: { emergency_open: 1, urgent_open: 0, unread_message_alerts_open: 0 },
  monthly_meetings: { available: 4, booked: 2, done: 6 },
  workload: [{ staff_id: "a", name: "Ada Coordinator", role: "care_coordinator", active: true, is_doctor: false, waiting: 2, past_target: 1, needs_doctor: 0 }],
  target_hours: 24,
  lookback_days: 14,
};

describe("CareOperationsPage", () => {
  it("says it could not load instead of showing zeros", () => {
    mockHook.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<CareOperationsPage messagesHref="/clinician/messages" alertsHref="/clinician/operations-queue" showDoctorLinks />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    expect(screen.queryByText("New messages today")).toBeNull();
  });

  it("links message tiles to the doctor's inbox views and the safety tiles to the doctor queues", () => {
    mockHook.mockReturnValue({ data: DATA, isLoading: false, isError: false });
    render(<CareOperationsPage messagesHref="/clinician/messages" alertsHref="/clinician/operations-queue" showDoctorLinks />);
    expect(screen.getByText("Support, waiting on a reply").closest("a")?.getAttribute("href")).toBe("/clinician/messages?view=support&unanswered=1");
    expect(screen.getByText("Needs a doctor").closest("a")?.getAttribute("href")).toBe("/clinician/messages?view=needs_doctor");
    expect(screen.getByText("Open emergency alerts").closest("a")?.getAttribute("href")).toBe("/clinician/operations-queue");
    expect(screen.getByText("Past the 24 hour reply target")).toBeTruthy();
    expect(screen.getByText("Ada Coordinator")).toBeTruthy();
  });

  it("gives a coordinator their own inbox, the read-only alert queue, and no links into doctor-only pages", () => {
    mockHook.mockReturnValue({ data: DATA, isLoading: false, isError: false });
    render(<CareOperationsPage messagesHref="/dashboard/care-coordinator/messages" alertsHref="/clinician/operations-queue" showDoctorLinks={false} />);
    expect(screen.getByText("Clinical, waiting on a reply").closest("a")?.getAttribute("href")).toBe(
      "/dashboard/care-coordinator/messages?view=clinical&unanswered=1"
    );
    expect(screen.getByText("Open emergency alerts").closest("a")?.getAttribute("href")).toBe("/clinician/operations-queue");
    expect(screen.getByText("Booked").closest("a")).toBeNull();
    expect(screen.queryByText(/results inbox/i)).toBeNull();
  });

  it("marks someone who has left but still holds a conversation", () => {
    mockHook.mockReturnValue({
      data: { ...DATA, workload: [{ ...DATA.workload[0], name: "Ben Gone", active: false }] },
      isLoading: false,
      isError: false,
    });
    render(<CareOperationsPage messagesHref="/clinician/messages" alertsHref="/clinician/operations-queue" showDoctorLinks />);
    expect(screen.getByText(/no longer active: reassign/)).toBeTruthy();
  });
});

describe("parseCareOperationsSummary", () => {
  it("refuses a malformed payload rather than defaulting to zero", () => {
    expect(() => parseCareOperationsSummary({ messages: {} })).toThrow();
    expect(parseCareOperationsSummary(DATA).messages.support_waiting).toBe(3);
  });
});
