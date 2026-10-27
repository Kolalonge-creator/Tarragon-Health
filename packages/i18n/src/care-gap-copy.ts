/**
 * Words for the care gap engine (S90, docs/design/S90.md). English only (decision D-14).
 *
 * Two audiences, kept apart on purpose:
 *   - PATIENT notification copy (the `patient.*` keys): neutral by design (INV-07). It never names a condition, a reading, a result, a medicine, a
 *     test or a number. The sender templates (supabase/functions/send-pending-notifications/templates.ts), the in-app preview (describe-in-app.ts)
 *     and the database locale rows all carry these exact words; packages/notifications/src/care-gap-templates.test.ts pins the four together.
 *   - STAFF screen copy (the `staff.*` keys): a coordinator or doctor may be told why a gap is open ("no blood pressure reading in 21 days"). That
 *     text is only ever shown on a staff screen, never in a notification.
 *
 * Rules held by care-gap-copy.test.ts: no em dashes; "your care team" never "your doctor"; the patient strings pass the forbidden-term list.
 * Nothing here is clinical wording a person needs to sign: the thresholds live in the PROPOSED config `care_gaps.rules`, not in these strings.
 */
export const careGapCopy = {
  // --- patient notification wording (neutral) ---
  "patient.first.push": "Something small is waiting for you in the app",
  "patient.first.in_app": "Something small is waiting for you in the app. Open it when you have a minute",
  "patient.first.sms": "Something small is waiting for you in the Tarragon Health app. Tarragon Health",
  "patient.first.email.subject": "A small step is waiting for you",
  "patient.first.email.body": "Something small is waiting for you in the Tarragon Health app. Open it when you have a minute.",
  "patient.followup.email.subject": "A small step is waiting for you",
  "patient.followup.email.body": "Your care team left a short step for you in the Tarragon Health app. It takes a minute or two.",
  "patient.followup.sms": "A short step from your care team is waiting in the Tarragon Health app. Tarragon Health",
  "patient.variant_b.in_app": "A short step from your care team is waiting in the app. It takes a minute or two",
  "patient.variant_b.push": "A short step from your care team is waiting in the app",
  "patient.variant_b.email.body": "A short step from your care team is waiting in the Tarragon Health app. It takes a minute or two.",

  // --- staff wording ---
  "staff.section.title": "Care gaps",
  "staff.section.intro":
    "Gaps the rules found for the patients you are assigned. Ranked by risk, then how long overdue, then a rising trend. A gap closes when a recorded outcome appears (a reading, a lab result, a refill). A message sent or opened never closes it.",
  "staff.section.empty": "No open care gaps assigned to you.",
  "staff.shadow.badge": "Shadow",
  "staff.shadow.note": "Shadow mode: the rules are not yet signed, so nobody has been contacted about this gap.",
  "staff.why.heading": "Why this gap is open",
  "staff.why.staff_only": "For staff only. This is never shown in a message to the patient.",
  "staff.why.last_seen": "Last recorded {date}",
  "staff.why.never": "None recorded yet, counted from the start of the plan on {date}",
  "staff.why.reading_bp": "No blood pressure reading in {days} days (the line is {line}).",
  "staff.why.reading_glucose": "No glucose reading in {days} days (the line is {line}).",
  "staff.why.lab": "No matching lab result in the last {lookback} days, and {grace} days have passed since it fell due.",
  "staff.why.trend": "The average blood pressure in the last {window} days is higher than in the {window} days before, by at least the line set in the rules. Review the readings.",
  "staff.why.refill": "The refill was due {days} days ago (the line is {line}).",
  "staff.why.adherence": "The adherence check flagged this patient. Signal seen {date}.",
  "staff.why.unknown": "The rule that opened this gap gave no detail.",
  "staff.type.missed_reading": "Missed reading",
  "staff.type.no_hba1c_12_months": "No HbA1c in 12 months",
  "staff.type.no_lipids_12_months": "No lipids in 12 months",
  "staff.type.rising_bp_trend": "Rising blood pressure trend",
  "staff.type.medication_refill_lapse": "Refill overdue",
  "staff.type.adherence_lapse": "Adherence below the line",
  "staff.owner.doctor": "Doctor review",
  "staff.owner.coordinator": "Coordinator",
  "staff.overdue": "{days} days overdue",
  "staff.trend.flag": "Rising trend",
  "staff.next.due": "Next attempt due {date}",
  "staff.next.overdue": "Next attempt overdue since {date}",
  "staff.next.none": "No attempt scheduled",
  "staff.attempts": "{n} attempts so far",
  "staff.log.heading": "Log a call or message",
  "staff.log.note": "What happened",
  "staff.log.result.call_reached": "Reached the patient",
  "staff.log.result.call_no_answer": "No answer",
  "staff.log.result.message_left": "Left a message",
  "staff.log.submit": "Log attempt",
  "staff.close.heading": "Close without an outcome",
  "staff.close.help": "A gap closes by itself when a reading, a lab result or a refill is recorded. Use this only when the patient declined, cannot be reached, or the gap was wrong.",
  "staff.close.declined": "Patient declined",
  "staff.close.unreachable": "Unreachable (needs two logged attempts)",
  "staff.close.wrong": "Gap was wrong",
  "staff.close.note": "Why",
  "staff.close.submit": "Close this gap",
  "staff.reason.closed": "Closed by a recorded outcome",
  "staff.reason.declined": "Declined",
  "staff.reason.unreachable": "Unreachable",
  "staff.reason.wrong": "Wrong",
  "staff.reason.superseded": "No longer applies",
  "staff.review.due": "Review due {date}",
  "staff.review.overdue": "Review overdue since {date}",
  "staff.review.escalated": "Handed to the Chief Medical Officer after the review date passed",
  "staff.unowned.title": "Care gaps with no owner",
  "staff.unowned.intro":
    "These gaps have no coordinator or doctor to hold them, so nobody else can see them. Assign a coordinator or a doctor to the organisation, or close one with a reason. They are visible to you only because nobody owns them.",
  "staff.unowned.empty": "No care gap is without an owner.",
  "staff.unowned.note": "No owner",

  // --- institution wording (counts of people only) ---
  "institution.title": "Care gaps found by the rules",
  "institution.intro":
    "People with at least one open gap of each kind, and gaps closed in the last 90 days by a recorded outcome (a reading, a lab result or a refill). People whose gap closed another way (declined, unreachable, wrong) are counted apart, under how they closed, never as closed. Counts of people only.",
  "institution.not_live": "These counts appear once the care gap rules have been signed and switched on.",
  "institution.withheld": "Withheld",
  "institution.withheld_note": "A figure for fewer than {min} people is withheld, and a second figure is withheld alongside it so a withheld count cannot be worked out by subtraction.",
  "institution.open": "Open",
  "institution.closed": "Closed in the last 90 days",
  "institution.closed_by_reason": "How they closed",
  "institution.any_open": "People with any open gap",
} as const;

export type CareGapCopyKey = keyof typeof careGapCopy;

export function careGapText(key: CareGapCopyKey, params?: Record<string, string | number>): string {
  let text: string = careGapCopy[key];
  for (const [k, v] of Object.entries(params ?? {})) text = text.split(`{${k}}`).join(String(v));
  return text;
}
