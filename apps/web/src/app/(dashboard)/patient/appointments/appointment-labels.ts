/** Human labels for the 10.1 appointment types, shared by the patient
 * booking picker and the clinician calendar. The full enum stays for
 * clinician/internal scheduling use, but the patient-facing picker
 * (PATIENT_BOOKABLE_APPOINTMENT_TYPES below) only ever offers telemedicine
 * and result-interpretation — Tarragon has no owned clinics and offers no
 * in-person appointment right now; second opinion is a separate, already-
 * built flow (second_opinion_requests), not a slot-booking appointment
 * type. */
export const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  gp: "GP",
  specialist: "Specialist",
  nurse: "Nurse",
  dietitian: "Dietitian",
  physiotherapist: "Physiotherapist",
  laboratory: "Laboratory",
  imaging: "Imaging",
  vaccination: "Vaccination",
  physical_clinic: "Physical clinic visit",
  telemedicine: "Video or audio visit",
  follow_up: "Follow-up",
  procedure: "Procedure",
  therapy: "Therapy session",
  result_interpretation: "Result Consultation",
};

/** The only appointment types a patient can currently book for themselves,
 * all with a Tarragon-employed doctor, all telemedicine — see the note on
 * APPOINTMENT_TYPE_LABELS above. */
export const PATIENT_BOOKABLE_APPOINTMENT_TYPES = [
  "telemedicine",
  "result_interpretation",
] as const;

/** Appointment types that carry a direct charge, satisfied by a pre-bought
 * single-use service_purchases credit — see the redemption logic inside
 * confirm_appointment_booking (20260831163838). Everything else stays free
 * (payment_status defaults 'not_required'). Shared by the booking flow
 * (book-appointment.tsx) and the upcoming-appointments list
 * (my-appointments-list.tsx), which both need to know which product code to
 * charge for a given appointment type. */
export const PAID_APPOINTMENT_PRODUCT_CODE: Partial<Record<string, string>> = {
  telemedicine: "video_visit_credit",
  result_interpretation: "result_interpretation_credit",
};

export const APPOINTMENT_STATUS_LABELS: Record<
  string,
  { label: string; tone: "blue" | "amber" | "green" | "red" | "grey" }
> = {
  held: { label: "Holding your slot…", tone: "amber" },
  // Only reached by a paid appointment type with no credit yet — a free type
  // resolves straight to 'confirmed' (see book-appointment.tsx). "Booked"
  // read as done when it actually meant payment still pending.
  booked: { label: "Awaiting payment", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "green" },
  checked_in: { label: "Checked in", tone: "blue" },
  in_progress: { label: "In progress", tone: "blue" },
  completed: { label: "Completed", tone: "grey" },
  cancelled: { label: "Cancelled", tone: "grey" },
  patient_cancelled: { label: "You cancelled this", tone: "grey" },
  provider_cancelled: { label: "Cancelled by your provider", tone: "red" },
  rescheduled: { label: "Rescheduled", tone: "grey" },
  no_show: { label: "Missed", tone: "grey" },
  expired: { label: "Expired", tone: "grey" },
  failed: { label: "Failed", tone: "red" },
};
