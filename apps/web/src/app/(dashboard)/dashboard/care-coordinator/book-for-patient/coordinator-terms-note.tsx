"use client";

import { koboToNaira } from "@tarragon/shared";
import { useMyBookingTerms, type BookingTerms } from "@/lib/queries/appointments";

const PER_ITEM_TYPES = ["dietitian", "pharmacist"];

/**
 * What the coordinator needs to tell the patient before booking, written about the patient. The shared "Before you pay" card is written
 * to the person who is signed in ("your Membership"), which is wrong when a coordinator books for someone on the Free plan. The numbers
 * (price, cancel window) are the same live ones: my_booking_terms does not depend on who asks.
 */
export function coordinatorTermsLines(args: { patientName: string; isMember: boolean; appointmentType: string; terms: BookingTerms }): string[] {
  const { patientName, isMember, appointmentType, terms } = args;
  const lines: string[] = [];
  if (PER_ITEM_TYPES.includes(appointmentType)) {
    lines.push(
      terms.price_kobo === null
        ? "This visit has no price set yet, so it cannot be booked."
        : `This visit costs ₦${koboToNaira(terms.price_kobo).toLocaleString("en-NG")}, paid for each visit.`,
    );
  } else {
    lines.push(
      isMember
        ? `A doctor visit is part of ${patientName}'s Membership.`
        : `A doctor visit is not part of the Free plan. ${patientName} needs to join Membership first.`,
    );
  }
  lines.push(
    terms.late_cancel_credit_returned
      ? `If it is cancelled, the visit credit comes back to ${patientName}.`
      : `If it is cancelled ${terms.cancel_window_hours} hours or more before the visit, the visit credit comes back to ${patientName}. Cancelling later uses the credit.`,
  );
  lines.push("If the care team cancels or does not come, the credit always comes back and the visit can be rebooked for free.");
  lines.push(`These visits are for people aged ${terms.min_age_years} and over.`);
  return lines;
}

export function CoordinatorTermsNote({ appointmentType, patientName, isMember }: { appointmentType: string; patientName: string; isMember: boolean }) {
  const { data, isError } = useMyBookingTerms(appointmentType);
  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Could not load the booking terms. Reload the page before booking.
      </p>
    );
  }
  if (!data) return null;
  return (
    <div className="space-y-1 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15" data-testid="coordinator-booking-terms">
      <p className="font-medium">Tell {patientName} before booking</p>
      {coordinatorTermsLines({ patientName, isMember, appointmentType, terms: data }).map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
