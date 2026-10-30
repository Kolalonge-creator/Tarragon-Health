/** The buttons a care-team member can attach to a message. Each is a fixed screen inside the app (the same
 * list the database allows in care_message_actions.kind), so a message can never carry an outside link. */
export const CARE_MESSAGE_ACTIONS = {
  book_appointment: { label: "Book an appointment", href: "/patient/appointments" },
  upload_result: { label: "Upload a result", href: "/patient/labs" },
  log_reading: { label: "Log a reading", href: "/patient/vitals" },
  review_medications: { label: "Review your medicines", href: "/patient/medications" },
} as const;

export type CareMessageActionKind = keyof typeof CARE_MESSAGE_ACTIONS;

export const CARE_MESSAGE_ACTION_KINDS = Object.keys(CARE_MESSAGE_ACTIONS) as CareMessageActionKind[];

export function isCareMessageActionKind(value: string): value is CareMessageActionKind {
  return value in CARE_MESSAGE_ACTIONS;
}
