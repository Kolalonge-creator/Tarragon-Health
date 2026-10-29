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
  const PRICED = terms({ price_kobo: 500000 });

  it("prices an extra meeting for a Member and points to the monthly meeting for the included one, naming the patient", () => {
    const t = text({ isMember: true, terms: PRICED });
    expect(t).toContain("An extra online meeting costs ₦5,000");
    expect(t).toContain("Mama Adaeze's monthly meeting is included in Membership");
    expect(t).not.toMatch(/\byour\b/i);
  });

  it("does NOT offer an extra meeting to a Free patient; it says they need Membership first", () => {
    const t = text({ isMember: false, terms: PRICED });
    expect(t).toContain("Extra meetings are for paid Members");
    expect(t).toContain("Mama Adaeze needs to join Membership first");
    expect(t).not.toContain("costs");
    expect(t).not.toMatch(/\byour\b/i);
  });

  it("says an extra meeting cannot be booked while no price is set", () => {
    expect(text({ isMember: true, terms: terms({ price_kobo: null }) })).toContain("no price is set");
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
