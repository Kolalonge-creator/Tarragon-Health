/**
 * The shared "Before you pay" card is written to the signed-in person ("your Membership"). When a coordinator books for someone else it
 * must read about that patient, and must not call a doctor visit part of the membership of a patient who is on the Free plan.
 */
import { coordinatorTermsLines } from "./coordinator-terms-note";
import type { BookingTerms } from "@/lib/queries/appointments";

const terms = (over: Partial<BookingTerms> = {}): BookingTerms => ({
  appointment_type: "telemedicine",
  price_kobo: null,
  bookable: true,
  cancel_window_hours: 2,
  late_cancel_credit_returned: false,
  refund_basis: "credit",
  min_age_years: 18,
  policy_version: 1,
  ...over,
});

const text = (args: { isMember: boolean; type?: string; terms?: BookingTerms }) =>
  coordinatorTermsLines({ patientName: "Mama Adaeze", isMember: args.isMember, appointmentType: args.type ?? "telemedicine", terms: args.terms ?? terms() }).join("\n");

describe("coordinatorTermsLines", () => {
  it("says a doctor visit is part of a Member's Membership, naming the patient", () => {
    const t = text({ isMember: true });
    expect(t).toContain("A doctor visit is part of Mama Adaeze's Membership.");
    expect(t).not.toMatch(/\byour\b/i);
  });

  it("does NOT say a doctor visit is included for a Free patient; it says they need Membership first", () => {
    const t = text({ isMember: false });
    expect(t).toContain("not part of the Free plan");
    expect(t).toContain("Mama Adaeze needs to join Membership first");
    expect(t).not.toContain("is part of");
    expect(t).not.toMatch(/\byour\b/i);
  });

  it("states the live cancel window and the adult age from the terms, not constants", () => {
    const t = text({ isMember: true, terms: terms({ cancel_window_hours: 6, min_age_years: 21 }) });
    expect(t).toContain("6 hours or more before");
    expect(t).toContain("aged 21 and over");
  });

  it("omits the late-cancel warning when the credit always comes back", () => {
    expect(text({ isMember: true, terms: terms({ late_cancel_credit_returned: true }) })).not.toContain("Cancelling later uses the credit");
  });

  it("prices a per-visit type and does not call it part of Membership", () => {
    const t = text({ isMember: true, type: "dietitian", terms: terms({ appointment_type: "dietitian", price_kobo: 500000 }) });
    expect(t).toContain("₦5,000");
    expect(t).not.toContain("part of");
  });

  it("says an unpriced per-visit type cannot be booked", () => {
    expect(text({ isMember: true, type: "pharmacist", terms: terms({ appointment_type: "pharmacist", price_kobo: null }) })).toContain("cannot be booked");
  });
});
