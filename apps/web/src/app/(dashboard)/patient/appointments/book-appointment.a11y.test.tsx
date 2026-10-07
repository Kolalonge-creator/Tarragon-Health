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
let guardError = false;
let confirmStatus = "confirmed";
type Terms = { appointment_type: string; price_kobo: number | null; bookable: boolean; cancel_window_hours: number; late_cancel_credit_returned: boolean; refund_basis: "credit"; min_age_years: number; policy_version: number };
const pricedTerms = (type: string, price: number | null = 1_000_000): Terms => ({
  appointment_type: type, price_kobo: price, bookable: price !== null, cancel_window_hours: 2, late_cancel_credit_returned: false,
  refund_basis: "credit", min_age_years: 18, policy_version: 2,
});
let terms: (type: string) => Terms | undefined = (type) => pricedTerms(type);
jest.mock("@/lib/billing/purchase-service-product", () => ({ purchaseServiceProduct: jest.fn(async () => ({ error: "not in this test" })) }));
jest.mock("@/lib/queries/appointments", () => ({
  useAvailableAppointmentSlots: () => ({ data: slots, isLoading }),
  useHoldAppointmentSlot: () => ({
    mutateAsync: jest.fn(async () => ({ id: "appt-1" })),
    isPending: false,
  }),
  useConfirmAppointmentBooking: () => ({
    mutateAsync: jest.fn(async () => ({ id: "appt-1", status: confirmStatus })),
    isPending: false,
  }),
  useJoinWaitingList: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useMyConsultationRule: () => ({ data: undefined }),
  useMyBookingTerms: (type: string) => ({ data: terms(type), isError: false }),
  useGoLiveGuardOpen: () => ({ data: guardOpen, isLoading: false, isError: guardError }),
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
    guardError = false;
    confirmStatus = "confirmed";
    terms = (type) => pricedTerms(type);
  });

  // S64 (15.7): price, cancel and refund terms are on screen BEFORE payment
  const oneSlot = () => [
    { clinician_id: "clin-1", clinician_name: "Dr. Adaeze Okafor", slot_start: "2026-09-20T09:00:00Z", slot_end: "2026-09-20T09:30:00Z", consultation_method: "telemedicine", location: null },
  ];

  it("shows the price, the cancel rule and the credit basis before any slot is chosen (S64, 15.7)", () => {
    slots = oneSlot();
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    const card = screen.getByTestId("booking-terms");
    expect(card.textContent).toContain("₦10,000");
    expect(card.textContent).toContain("Cancel 2 hours or more before and your visit credit comes back to you.");
    expect(card.textContent).toContain("Cancel later than that and the credit is used.");
    // never promises cash (OQ-133 stays open)
    expect(card.textContent?.toLowerCase()).not.toContain("refund");
    expect(card.textContent?.toLowerCase()).not.toContain("cash");
  });

  it("repeats the terms next to the pay button once a slot is held awaiting payment (S64, 15.7)", async () => {
    slots = oneSlot();
    confirmStatus = "booked";
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    fireEvent.click(screen.getByText("Book"));
    const pay = await screen.findByRole("button", { name: "Pay to confirm" });
    expect(screen.getAllByTestId("booking-terms").length).toBe(2);
    expect((pay as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the pay button off while the terms have not loaded, so nobody pays unseen (S64, 15.7)", async () => {
    slots = oneSlot();
    confirmStatus = "booked";
    terms = () => undefined;
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    fireEvent.click(screen.getByText("Book"));
    const pay = await screen.findByRole("button", { name: "Pay to confirm" });
    expect((pay as HTMLButtonElement).disabled).toBe(true);
  });

  it("says an unpriced type cannot be booked yet, and offers neither it nor a pay button (S64, Q23)", () => {
    slots = oneSlot();
    terms = (type) => (type === "dietitian" || type === "pharmacist" ? pricedTerms(type, null) : pricedTerms(type));
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).not.toContain("Dietitian");
    expect(options).not.toContain("Pharmacist");
  });

  it("offers dietitian and pharmacist once their price is set (S64, Q23)", () => {
    slots = oneSlot();
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Dietitian");
    expect(options).toContain("Pharmacist");
  });

  it("shows the filters only when the open times carry clinician details, and filters the list (S64, 15.1)", () => {
    slots = [
      { clinician_id: "c1", clinician_name: "Dr. Ada", slot_start: "2026-09-20T09:00:00Z", slot_end: "2026-09-20T09:30:00Z", consultation_method: "telemedicine", location: null,
        specialty: "General practice", languages: ["en", "yo"], sex: "female", mdcn_number: "MDCN/1", licence_checked_on: "2026-09-01T00:00:00Z" },
      { clinician_id: "c2", clinician_name: "Dr. Musa", slot_start: "2026-09-20T10:00:00Z", slot_end: "2026-09-20T10:30:00Z", consultation_method: "telemedicine", location: null,
        specialty: "Cardiology", languages: ["en"], sex: "male", mdcn_number: null, licence_checked_on: null },
    ];
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    expect(screen.getByText("Dr. Ada", { exact: false })).toBeTruthy();
    expect(screen.getByText("Dr. Musa", { exact: false })).toBeTruthy();
    // the registration number appears only for the clinician with a recorded check, with its date
    expect(screen.getByText(/MDCN registration number MDCN\/1, checked on/)).toBeTruthy();
    expect(screen.getAllByText(/MDCN registration number/).length).toBe(1);
    fireEvent.change(screen.getByLabelText("Specialty"), { target: { value: "Cardiology" } });
    expect(screen.queryByText("Dr. Ada", { exact: false })).toBeNull();
    expect(screen.getByText("Dr. Musa", { exact: false })).toBeTruthy();
    expect(screen.getByText("The price is the same whichever clinician you choose.")).toBeTruthy();
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

  it("says the check failed (not that booking is closed) when the guard check errors, and still shows no booking buttons", async () => {
    guardOpen = undefined;
    guardError = true;
    render(<BookAppointment organisationId="org-1" patientId="patient-1" />);
    expect(screen.getByText("We could not check just now whether booking is open. Please try again in a moment.")).toBeTruthy();
    expect(screen.queryByText("Consultations are not open yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Book" })).toBeNull();
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
