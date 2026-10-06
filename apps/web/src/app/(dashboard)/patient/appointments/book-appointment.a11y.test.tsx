/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for BookAppointment — the patient-facing
 * booking flow. Covers the loading state, a list of open slots, and the
 * "no open slots" / waiting-list state, since each renders materially
 * different DOM (a <ul> of bookable slots vs. an empty-state button).
 */
import { useRouter } from "next/navigation";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { BookAppointment } from "./book-appointment";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));
(useRouter as jest.Mock).mockReturnValue({ replace: jest.fn(), push: jest.fn() });

let slots: unknown[] | undefined;
let isLoading = false;
let guardOpen: boolean | undefined = true;
jest.mock("@/lib/queries/appointments", () => ({
  useAvailableAppointmentSlots: () => ({ data: slots, isLoading }),
  useHoldAppointmentSlot: () => ({
    mutateAsync: jest.fn(async () => ({ id: "appt-1" })),
    isPending: false,
  }),
  useConfirmAppointmentBooking: () => ({
    mutateAsync: jest.fn(async () => ({ id: "appt-1", status: "confirmed" })),
    isPending: false,
  }),
  useJoinWaitingList: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMyConsultationRule: () => ({ data: undefined }),
  useGoLiveGuardOpen: () => ({ data: guardOpen, isLoading: false }),
  useEnsureAppointmentVideoConsultation: () => ({
    mutateAsync: jest.fn(async () => ({ videoConsultationId: "vc-1" })),
    isPending: false,
  }),
}));

describe("BookAppointment accessibility", () => {
  beforeEach(() => {
    slots = undefined;
    isLoading = false;
    guardOpen = true;
  });

  it("with the go-live guard off, shows a calm closed state and no times or booking buttons (S37, INV-14)", async () => {
    guardOpen = false;
    slots = [
      { clinician_id: "clin-1", clinician_name: "Dr. Adaeze Okafor", slot_start: "2026-09-20T09:00:00Z", slot_end: "2026-09-20T09:30:00Z", consultation_method: "telemedicine", location: null },
    ];
    await expectNoA11yViolations(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    expect(screen.getByText("Consultations are not open yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
    expect(screen.queryByText("Join the waiting list")).toBeNull();
  });

  it("fails closed when the guard check has no answer", async () => {
    guardOpen = undefined;
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    expect(screen.getByText("Consultations are not open yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
  });

  it("has no axe violations while loading available slots", async () => {
    isLoading = true;
    await expectNoA11yViolations(
      <BookAppointment organisationId="org-1" patientId="patient-1" />
    );
  });

  it("has no axe violations with a list of open slots", async () => {
    slots = [
      {
        clinician_id: "clin-1",
        clinician_name: "Dr. Adaeze Okafor",
        slot_start: "2026-09-20T09:00:00Z",
        slot_end: "2026-09-20T09:30:00Z",
        consultation_method: "telemedicine",
        location: null,
      },
      {
        clinician_id: "clin-2",
        clinician_name: "Dr. Musa Bello",
        slot_start: "2026-09-20T10:00:00Z",
        slot_end: "2026-09-20T10:30:00Z",
        consultation_method: "telemedicine",
        location: null,
      },
    ];
    await expectNoA11yViolations(
      <BookAppointment organisationId="org-1" patientId="patient-1" />
    );
  });

  it("has no axe violations when there are no open slots (waiting-list offer)", async () => {
    slots = [];
    await expectNoA11yViolations(
      <BookAppointment organisationId="org-1" patientId="patient-1" />
    );
  });

  it("announces a successful booking through a live region, with no axe violations", async () => {
    slots = [
      {
        clinician_id: "clin-1",
        clinician_name: "Dr. Adaeze Okafor",
        slot_start: "2026-09-20T09:00:00Z",
        slot_end: "2026-09-20T09:30:00Z",
        consultation_method: "telemedicine",
        location: null,
      },
    ];
    const { container } = await expectNoA11yViolations(
      <BookAppointment organisationId="org-1" patientId="patient-1" />
    );
    fireEvent.click(screen.getByText("Book"));
    const confirmation = await screen.findByText(/^Booked for /);
    // A success message that appears only after an async booking completes
    // must be announced to a screen-reader user via a live region, not just
    // shown visually.
    expect(confirmation.getAttribute("role")).toBe("status");
    expect(await axe(container)).toHaveNoViolations();
  });
});
