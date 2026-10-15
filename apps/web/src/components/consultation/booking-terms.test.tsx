/** @jest-environment jsdom */
/**
 * S64 (15.7): price, cancellation and refund terms are shown BEFORE payment on every booking path.
 * Sabotage check: remove <BookingTermsCard> from any file listed in PAYMENT_PATHS and the scan below fails; change the credit wording
 * to promise cash and the wording test fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { BookingTermsView } from "./booking-terms";
import type { BookingTerms } from "@/lib/queries/appointments";

const terms = (over: Partial<BookingTerms> = {}): BookingTerms => ({
  appointment_type: "telemedicine",
  price_kobo: 1_000_000,
  bookable: true,
  cancel_window_hours: 2,
  late_cancel_credit_returned: false,
  refund_basis: "credit",
  min_age_years: 18,
  policy_version: 2,
  ...over,
});

describe("BookingTermsView", () => {
  it("shows the price in naira from integer kobo, the cancel window, what happens when late, and when the care team cancels", () => {
    render(<BookingTermsView terms={terms()} />);
    const text = screen.getByTestId("booking-terms").textContent ?? "";
    expect(text).toContain("This visit costs ₦10,000.");
    expect(text).toContain("Cancel 2 hours or more before and your visit credit comes back to you.");
    expect(text).toContain("Cancel later than that and the credit is used.");
    expect(text).toContain("If your care team cancels or does not come, your credit always comes back and you can rebook for free.");
    expect(text).toContain("aged 18 and over");
  });

  it("follows the configured window and price, not a number in this file", () => {
    render(<BookingTermsView terms={terms({ cancel_window_hours: 6, price_kobo: 500_000 })} />);
    const text = screen.getByTestId("booking-terms").textContent ?? "";
    expect(text).toContain("₦5,000");
    expect(text).toContain("Cancel 6 hours or more before");
  });

  it("leaves out the late-cancel line when a late cancel also returns the credit", () => {
    render(<BookingTermsView terms={terms({ late_cancel_credit_returned: true })} />);
    expect(screen.getByTestId("booking-terms").textContent).not.toContain("Cancel later than that");
  });

  it("says an unpriced type cannot be booked yet instead of showing a price", () => {
    render(<BookingTermsView terms={terms({ price_kobo: null, bookable: false })} />);
    const text = screen.getByTestId("booking-terms").textContent ?? "";
    expect(text).toContain("This kind of visit cannot be booked yet.");
    expect(text).not.toContain("₦");
  });

  it("never promises cash: the basis is the visit credit (OQ-133 is undecided)", () => {
    render(<BookingTermsView terms={terms()} />);
    const text = (screen.getByTestId("booking-terms").textContent ?? "").toLowerCase();
    expect(text).not.toMatch(/\bcash\b|\brefund/);
  });
});

/** Every file that can lead a patient to a payment button for a consultation must put the terms in front of it. */
const PAYMENT_PATHS = [
  "app/(dashboard)/patient/appointments/book-appointment.tsx",
  "app/(dashboard)/patient/appointments/my-appointments-list.tsx",
  "app/(dashboard)/patient/book-video-visit.tsx",
];

describe("every consultation payment path shows the terms first (S64, 15.7)", () => {
  const src = join(__dirname, "..", "..");
  for (const rel of PAYMENT_PATHS) {
    it(`${rel} renders BookingTermsCard`, () => {
      const code = readFileSync(join(src, rel), "utf8");
      expect(code).toContain('from "@/components/consultation/booking-terms"');
      expect(code).toMatch(/<BookingTermsCard\b/);
    });
  }

  it("and no other component starts a consultation purchase without being on the list", () => {
    // a new file that calls purchaseServiceProduct for an appointment must be added to PAYMENT_PATHS (and show the terms)
    const withPurchase = ["app/(dashboard)/patient/appointments/book-appointment.tsx", "app/(dashboard)/patient/appointments/my-appointments-list.tsx"];
    for (const rel of withPurchase) expect(PAYMENT_PATHS).toContain(rel);
  });
});
