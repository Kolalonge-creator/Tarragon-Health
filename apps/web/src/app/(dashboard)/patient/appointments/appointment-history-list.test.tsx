/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { AppointmentHistoryList } from "./appointment-history-list";

type HistoryState = { data?: unknown[]; isLoading: boolean; isError: boolean };
let history: HistoryState = { data: [], isLoading: false, isError: false };
let summaries: { data?: unknown[] } = { data: [] };
const historyCalls: unknown[][] = [];
jest.mock("@/lib/queries/appointments", () => ({
  useMyAppointmentHistory: (...args: unknown[]) => {
    historyCalls.push(args);
    return history;
  },
}));
jest.mock("@/lib/queries/patient-visit-summaries", () => ({ useMyVisitSummaries: () => summaries }));

const row = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  appointment_type: "telemedicine",
  status: "completed",
  payment_status: "paid",
  scheduled_for: "2026-10-01T09:00:00Z",
  consultation_method: "telemedicine",
  location: null,
  clinician: { full_name: "Dr. Musa Bello" },
  ...over,
});

describe("AppointmentHistoryList", () => {
  beforeEach(() => {
    history = { data: [], isLoading: false, isError: false };
    summaries = { data: [] };
    historyCalls.length = 0;
  });

  it("says Couldn't load on a failed read, never the empty line", () => {
    history = { data: undefined, isLoading: false, isError: true };
    render(<AppointmentHistoryList patientId="p1" isSelf view="missed" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn.t load these appointments/);
    expect(screen.queryByText("No missed appointments.")).toBeNull();
  });

  it("shows the view's own empty line", () => {
    render(<AppointmentHistoryList patientId="p1" isSelf view="cancelled" />);
    expect(screen.getByText("No cancelled appointments.")).toBeTruthy();
    expect(historyCalls[0]).toEqual(["p1", "cancelled"]);
  });

  it("links a past visit to the visit summaries only when one exists", () => {
    history = { data: [row()], isLoading: false, isError: false };
    const { rerender } = render(<AppointmentHistoryList patientId="p1" isSelf view="past" />);
    expect(screen.queryByText("Read your visit summaries")).toBeNull();
    summaries = { data: [{ id: "s1" }] };
    rerender(<AppointmentHistoryList patientId="p1" isSelf view="past" />);
    expect(screen.getByText("Read your visit summaries").closest("a")?.getAttribute("href")).toBe("/patient/care#after-visit-summary");
  });

  it("says when a cancelled visit's credit went back", () => {
    history = { data: [row({ status: "patient_cancelled", payment_status: "refunded" })], isLoading: false, isError: false };
    render(<AppointmentHistoryList patientId="p1" isSelf view="cancelled" />);
    expect(screen.getByText("Your visit credit was returned.")).toBeTruthy();
    expect(screen.getByText("You cancelled this")).toBeTruthy();
  });
});
