/**
 * Care Circle typed help requests (P22, founder decision PD-08, 2026-11-06): the kind of help a patient asks their Care Circle for, the
 * optional short note, and the "not an emergency service" line shown on both sides (`circlehelp.`). English only.
 *
 * EVERY STRING IN THIS FILE IS PROPOSED COPY AWAITING CMO REVIEW. The prefix sits outside the reviewed-strings ledger's `circle.`
 * namespace (whose baseline can only shrink), the same way `circlep1.` to `circlep5.` do; CIRCLE_HELP_REQUESTS_COPY_REVIEW below is the
 * marker and nobody but the CMO marks anything reviewed.
 *
 * Rules held by tests: no em dashes; never "doctor-led" or "your doctor"; no WhatsApp; no condition, reading or medicine named; the
 * "not an emergency service" line names the nearest hospital, matching the existing help card's emergency guidance.
 */
export const circleHelpRequestsCopy = {
  "circlehelp.type.label": "What would you like help with?",
  "circlehelp.type.booking": "Help booking an appointment",
  "circlehelp.type.test_payment": "Help paying for a test",
  "circlehelp.type.medicine_collection": "Collecting my medicines",
  "circlehelp.type.transport": "Transport to get somewhere",
  "circlehelp.type.call_me": "Please call me",
  "circlehelp.type.required": "Choose what you would like help with first.",
  "circlehelp.note.label": "A short note (optional)",
  "circlehelp.note.hint": "Up to 200 characters. The people you chose will read it, so please leave out medical details.",
  "circlehelp.invalid": "That could not be sent. Please choose what you need help with and keep the note under 200 characters.",
  "circlehelp.not_emergency": "This is not an emergency service. If you need care now, go to the nearest hospital.",
  "circlehelp.view.asked_for": "They asked for: {type}",
  "circlehelp.view.general": "They asked you to get in touch.",
  "circlehelp.view.note": "Their note: {note}",
} as const;

export type CircleHelpRequestsCopyKey = keyof typeof circleHelpRequestsCopy;

export const CIRCLE_HELP_REQUESTS_COPY_REVIEW = {
  status: "proposed",
  reviewer: null,
  reviewedOn: null,
  owner: "CMO",
  source: "supabase/migrations/20261107011314_care_circle_typed_help_requests.sql",
  prefixes: ["circlehelp."],
} as const;
