/** Human labels for the 10.1 appointment types, shared by the patient
 * booking picker and the clinician calendar. */
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
  telemedicine: "Telemedicine check-in",
  follow_up: "Follow-up",
  procedure: "Procedure",
  therapy: "Therapy session",
};

export const APPOINTMENT_STATUS_LABELS: Record<
  string,
  { label: string; tone: "blue" | "amber" | "green" | "red" | "grey" }
> = {
  held: { label: "Holding your slot…", tone: "amber" },
  booked: { label: "Booked", tone: "blue" },
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
