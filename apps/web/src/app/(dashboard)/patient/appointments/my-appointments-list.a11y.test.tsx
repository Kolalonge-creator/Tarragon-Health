/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for MyAppointmentsList — covers a mix
 * of appointment statuses (held/pay-to-confirm/joinable/cancellable) plus a
 * waiting-list section, since each status renders a different action button.
 */
import { useRouter } from "next/navigation";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { MyAppointmentsList } from "./my-appointments-list";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));
(useRouter as jest.Mock).mockReturnValue({ replace: jest.fn(), push: jest.fn() });

let appointments: unknown[] | undefined;
let waitingList: unknown[] | undefined;
jest.mock("@/lib/queries/appointments", () => ({
  useMyUpcomingAppointments: () => ({ data: appointments, isLoading: false }),
  useMyWaitingListEntries: () => ({ data: waitingList }),
  useCancelAppointment: () => ({
    mutateAsync: jest.fn(async () => {
      throw new Error("Could not cancel that appointment right now.");
    }),
    isPending: false,
  }),
  useConfirmAppointmentBooking: () => ({ mutate: jest.fn(), isPending: false }),
  useJoinWaitingList: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCancelWaitingListEntry: () => ({ mutate: jest.fn(), isPending: false }),
  useAcceptWaitingListOffer: () => ({ mutate: jest.fn(), isPending: false }),
  useEnsureAppointmentVideoConsultation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

describe("MyAppointmentsList accessibility", () => {
  beforeEach(() => {
    appointments = [];
    waitingList = [];
  });

  it("has no axe violations with no upcoming appointments", async () => {
    await expectNoA11yViolations(<MyAppointmentsList patientId="patient-1" />);
  });

  it("has no axe violations across held/booked/confirmed/waiting-list states", async () => {
    appointments = [
      {
        id: "appt-1",
        appointment_type: "telemedicine",
        status: "held",
        scheduled_for: "2026-09-20T09:00:00Z",
        consultation_method: "telemedicine",
        location: null,
        clinician: { full_name: "Dr. Adaeze Okafor" },
      },
      {
        id: "appt-2",
        appointment_type: "telemedicine",
        status: "booked",
        scheduled_for: "2026-09-21T09:00:00Z",
        consultation_method: "telemedicine",
        location: null,
        clinician: { full_name: "Dr. Musa Bello" },
      },
      {
        id: "appt-3",
        appointment_type: "telemedicine",
        status: "confirmed",
        scheduled_for: "2026-09-22T09:00:00Z",
        consultation_method: "telemedicine",
        location: null,
        clinician: { full_name: "Dr. Chidinma Eze" },
      },
    ];
    waitingList = [
      { id: "wl-1", appointment_type: "telemedicine", status: "offered" },
      { id: "wl-2", appointment_type: "telemedicine", status: "waiting" },
    ];
    await expectNoA11yViolations(<MyAppointmentsList patientId="patient-1" />);
  });

  it("announces a failed cancellation through a live region, with no axe violations", async () => {
    appointments = [
      {
        id: "appt-1",
        appointment_type: "telemedicine",
        status: "confirmed",
        scheduled_for: "2026-09-22T09:00:00Z",
        consultation_method: "telemedicine",
        location: null,
        clinician: { full_name: "Dr. Chidinma Eze" },
      },
    ];
    const { container } = await expectNoA11yViolations(<MyAppointmentsList patientId="patient-1" />);
    fireEvent.click(screen.getByText("Cancel"));
    const failure = await screen.findByText("Could not cancel that appointment right now.");
    // An error surfaced only after a failed async action must be announced
    // to a screen-reader user via a live region, not just shown visually.
    expect(failure.getAttribute("role")).toBe("alert");
    expect(await axe(container)).toHaveNoViolations();
  });
});
