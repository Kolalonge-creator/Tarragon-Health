/**
 * Care Circle Phase 4 (2026-11-04): the main/backup family contact and the family timeline (`circlep4.`). English only.
 *
 * PROPOSED COPY AWAITING CMO AND DPO REVIEW. The founder approved the 263 Care Circle strings of Phases 1 to 3 on 2026-11-04
 * (docs/DECISIONS.md CC-COPY); these were written after that and are NOT covered by it. CIRCLE_P4_COPY_REVIEW is the marker; nobody but
 * the CMO marks it reviewed.
 *
 * Rules held by tests: no em dashes; never "doctor-led" or "your doctor"; no WhatsApp; no condition, reading or medicine named.
 */
export const circleP4Copy = {
  "circlep4.contact.label": "Family contact",
  "circlep4.contact.none": "Not a main or backup contact",
  "circlep4.contact.primary": "Main family contact",
  "circlep4.contact.backup": "Backup family contact",
  "circlep4.contact.hint": "Who we and your care team can think of first for help with arrangements. It does not let them see anything more, and it is not your emergency contact.",
  "circlep4.contact.save_error": "That could not be saved. Please try again.",
  "circlep4.contact.you_primary": "{name} has made you their main family contact.",
  "circlep4.contact.you_backup": "{name} has made you their backup family contact.",
  "circlep4.timeline.title": "Recent activity",
  "circlep4.timeline.empty": "Nothing to show from the last 90 days.",
  "circlep4.timeline.error": "We could not load this just now.",
  "circlep4.timeline.doctor_note_shared": "A note from the care team was shared with you",
  "circlep4.timeline.appointment_attended": "Went to an appointment",
  "circlep4.timeline.appointment_missed": "Missed an appointment",
  "circlep4.timeline.test_requested": "{test} was requested",
  "circlep4.timeline.test_reviewed": "{test} was reviewed by a doctor",
  "circlep4.timeline.help_requested": "Asked for help: {kind}",
  "circlep4.timeline.help_done": "Help given: {kind}",
  "circlep4.timeline.source.clinician": "From the care team",
  "circlep4.timeline.source.patient": "From {name}",
  "circlep4.timeline.source.system": "Recorded by Tarragon",
} as const;

export type CircleP4CopyKey = keyof typeof circleP4Copy;

export const CIRCLE_P4_COPY_REVIEW = {
  status: "pending_cmo_review",
  owner: "CMO",
  also: "DPO",
  source: "supabase/migrations/20261104211059_care_circle_p4_timeline_contacts.sql",
  prefixes: ["circlep4."],
} as const;
