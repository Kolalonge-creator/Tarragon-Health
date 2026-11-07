/**
 * The four ways a patient can look at their appointments (patient dashboard 2.0 gap P15): what is coming, what happened, what was
 * cancelled and what was missed. "Upcoming" keeps the existing list and its statuses (lib/queries/appointments.ts); the other three
 * read history by status. A rescheduled row is left out on purpose: the visit moved, and its new row is shown instead. A hold that
 * timed out ('expired') or a booking that failed is not something the patient cancelled or missed, so neither is listed here.
 */
export const APPOINTMENT_VIEWS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
  { id: "missed", label: "Missed" },
] as const;

export type AppointmentViewId = (typeof APPOINTMENT_VIEWS)[number]["id"];
export type AppointmentHistoryView = Exclude<AppointmentViewId, "upcoming">;

export const HISTORY_STATUSES: Record<AppointmentHistoryView, readonly string[]> = {
  past: ["completed"],
  cancelled: ["cancelled", "patient_cancelled", "provider_cancelled"],
  missed: ["no_show"],
};

export const HISTORY_EMPTY_TEXT: Record<AppointmentHistoryView, string> = {
  past: "No past appointments yet.",
  cancelled: "No cancelled appointments.",
  missed: "No missed appointments.",
};

/** The statuses cancel_appointment and reschedule_appointment both accept from the patient side. */
export const CHANGEABLE_STATUSES: readonly string[] = ["held", "booked", "confirmed"];

export type CancelOutcomeInput = {
  consultationMethod: string;
  paymentStatus: string;
  scheduledFor: string;
  nowMs: number;
  /** From my_booking_terms; null while it has not loaded or could not be read. */
  terms: { cancel_window_hours: number; late_cancel_credit_returned: boolean } | null;
};

/**
 * What happens next if the patient cancels, in plain words, mirroring cancel_appointment (the database decides; this only explains).
 * A paid remote consultation gets its visit credit back when cancelled in time, or late when the policy says so. No money moves in
 * either case (OQ-133: whether cash is ever returned is undecided), so this never promises a refund. A visit that was not paid for has
 * nothing to return. Anything else that was paid is left to the care team to explain, because its rule is not a consultation rule.
 */
export function cancelOutcomeLines(input: CancelOutcomeInput): string[] {
  const lines = ["The time is freed for someone else, and we will confirm the cancellation in the app."];
  const isConsult = input.consultationMethod === "telemedicine";
  if (input.paymentStatus !== "paid") {
    lines.push("Nothing has been paid for this visit, so nothing is charged.");
    return lines;
  }
  if (!isConsult) {
    lines.push("The care team will tell you about anything already paid for this visit.");
    return lines;
  }
  if (!input.terms) {
    lines.push("We could not load the cancellation rule just now. The visit credit follows the rule shown when you booked.");
    return lines;
  }
  const hoursUntil = (new Date(input.scheduledFor).getTime() - input.nowMs) / 3_600_000;
  const late = hoursUntil < input.terms.cancel_window_hours;
  if (!late || input.terms.late_cancel_credit_returned) {
    lines.push("Your visit credit comes back to you, so you can book another time.");
  } else {
    lines.push(
      `This is less than ${input.terms.cancel_window_hours} hours before the visit, so the visit credit is not returned. Rescheduling keeps it.`,
    );
  }
  return lines;
}
