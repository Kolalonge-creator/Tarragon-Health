/** @jest-environment jsdom */
/**
 * P15: cancelling asks first ("Cancel this appointment?") and says what happens next; Reschedule opens the slot picker; a failed read
 * says "Couldn't load", never "No upcoming appointments".
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MyAppointmentsList } from "./my-appointments-list";

jest.mock("@/components/consultation/intake-form", () => ({ IntakeForm: () => null }));
jest.mock("@/components/consultation/booking-terms", () => ({ BookingTermsCard: () => null }));
jest.mock("@/components/consultation/consultation-rule", () => ({ ConsultationRuleCard: () => null }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock("./reschedule-appointment", () => ({ RescheduleAppointment: () => <div data-testid="reschedule-panel" /> }));

let appointments: unknown[] | undefined = [];
let isError = false;
const cancelMutate = jest.fn(async () => ({}));
jest.mock("@/lib/queries/appointments", () => ({
  useMyUpcomingAppointments: () => ({ data: appointments, isLoading: false, isError }),
  useMyWaitingListEntries: () => ({ data: [] }),
  useMyUpcomingEncounters: () => ({ data: [] }),
  useCancelAppointment: () => ({ mutateAsync: cancelMutate, isPending: false }),
  useConfirmAppointmentBooking: () => ({ mutate: jest.fn(), isPending: false }),
  useCancelWaitingListEntry: () => ({ mutate: jest.fn(), isPending: false }),
  useAcceptWaitingListOffer: () => ({ mutate: jest.fn(), isPending: false }),
  useEnsureAppointmentVideoConsultation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMyBookingTerms: () => ({ data: { cancel_window_hours: 2, late_cancel_credit_returned: false }, isLoading: false }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
});

const paidConsult = {
  id: "appt-1",
  organisation_id: "org-1",
  clinician_id: "clin-1",
  appointment_type: "telemedicine",
  status: "confirmed",
  payment_status: "paid",
  scheduled_for: "2099-01-10T10:00:00Z",
  consultation_method: "telemedicine",
  location: null,
  clinician: { full_name: "Dr. Chidinma Eze" },
};

describe("MyAppointmentsList cancel and reschedule", () => {
  beforeEach(() => {
    appointments = [paidConsult];
    isError = false;
    cancelMutate.mockClear();
  });

  it("asks before cancelling and explains the credit, and Keep it cancels nothing", () => {
    render(<MyAppointmentsList patientId="patient-1" />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Cancel this appointment?")).toBeTruthy();
    expect(screen.getByText(/visit credit comes back to you/)).toBeTruthy();
    fireEvent.click(screen.getByText("Keep it"));
    expect(cancelMutate).not.toHaveBeenCalled();
  });

  it("cancels only after Yes, and says it is under Cancelled", async () => {
    render(<MyAppointmentsList patientId="patient-1" />);
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Yes, cancel it"));
    await waitFor(() => expect(cancelMutate).toHaveBeenCalledWith({ appointmentId: "appt-1" }));
    expect(await screen.findByText(/You can see it under Cancelled/)).toBeTruthy();
  });

  it("opens the reschedule picker for a changeable appointment", () => {
    render(<MyAppointmentsList patientId="patient-1" />);
    expect(screen.queryByTestId("reschedule-panel")).toBeNull();
    fireEvent.click(screen.getByText("Reschedule"));
    expect(screen.getByTestId("reschedule-panel")).toBeTruthy();
  });

  it("offers no Reschedule or Cancel once a visit is under way", () => {
    appointments = [{ ...paidConsult, status: "in_progress" }];
    render(<MyAppointmentsList patientId="patient-1" />);
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.queryByText("Cancel")).toBeNull();
  });

  it("says Couldn't load when the read fails, never the empty line", () => {
    appointments = undefined;
    isError = true;
    render(<MyAppointmentsList patientId="patient-1" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn.t load your upcoming appointments/);
    expect(screen.queryByText("No upcoming appointments yet.")).toBeNull();
  });
});
