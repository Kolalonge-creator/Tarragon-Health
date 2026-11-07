/** @jest-environment jsdom */
/**
 * Regression: "Join call" used to show on status alone, days before the visit.
 * It must appear only inside the join window (15 minutes before to 60 after,
 * `consultations.policy`), with a "You can join from" line before that.
 */
import { render, screen } from "@testing-library/react";
import { MyAppointmentsList } from "./my-appointments-list";

jest.mock("@/components/consultation/intake-form", () => ({ IntakeForm: () => null }));
jest.mock("@/components/consultation/booking-terms", () => ({ BookingTermsCard: () => null }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));

let appointments: unknown[] = [];
jest.mock("@/lib/queries/appointments", () => ({
  useMyUpcomingAppointments: () => ({ data: appointments, isLoading: false }),
  useMyWaitingListEntries: () => ({ data: [] }),
  useMyUpcomingEncounters: () => ({ data: [] }),
  useMyConsultationRule: () => ({ data: undefined }),
  useCancelAppointment: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useConfirmAppointmentBooking: () => ({ mutate: jest.fn(), isPending: false }),
  useCancelWaitingListEntry: () => ({ mutate: jest.fn(), isPending: false }),
  useAcceptWaitingListOffer: () => ({ mutate: jest.fn(), isPending: false }),
  useEnsureAppointmentVideoConsultation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMyBookingTerms: () => ({ data: { cancel_window_hours: 2, late_cancel_credit_returned: false }, isLoading: false }),
}));
jest.mock("./reschedule-appointment", () => ({ RescheduleAppointment: () => <div data-testid="reschedule-panel" /> }));

const NOW = new Date("2026-11-10T10:00:00Z");
const appt = (minutesFromNow: number, status = "confirmed") => ({
  id: "appt-1",
  appointment_type: "telemedicine",
  status,
  scheduled_for: new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString(),
  consultation_method: "telemedicine",
  location: null,
  clinician: { full_name: "Dr. Chidinma Eze" },
});

describe("MyAppointmentsList join window", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  it("hides Join call two days before and says when joining opens", () => {
    appointments = [appt(2 * 24 * 60)];
    render(<MyAppointmentsList patientId="patient-1" />);
    expect(screen.queryByText("Join call")).toBeNull();
    expect(screen.getByText(/You can join from/)).toBeTruthy();
  });

  it("shows Join call ten minutes before the start", () => {
    appointments = [appt(10)];
    render(<MyAppointmentsList patientId="patient-1" />);
    expect(screen.getByText("Join call")).toBeTruthy();
  });

  it("hides Join call once the window has closed", () => {
    appointments = [appt(-90)];
    render(<MyAppointmentsList patientId="patient-1" />);
    expect(screen.queryByText("Join call")).toBeNull();
    expect(screen.queryByText(/You can join from/)).toBeNull();
  });

  it("keeps Join call for a visit already under way after the closing minute", () => {
    appointments = [appt(-90, "in_progress")];
    render(<MyAppointmentsList patientId="patient-1" />);
    expect(screen.getByText("Join call")).toBeTruthy();
  });
});
