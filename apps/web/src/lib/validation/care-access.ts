import { z } from "zod";

/**
 * Relationships offered when nominating a next of kin. Deliberately a plain TS
 * union rather than a database enum: the old family_relationship type existed
 * only to describe who was on somebody's bill and went with that table in
 * 20260729143514. This value is stored as free text on
 * profiles.emergency_contact_relationship, which is where the escalation path
 * already reads it from.
 */
export const NEXT_OF_KIN_RELATIONSHIPS = [
  "spouse",
  "child",
  "parent",
  "sibling",
  "other",
] as const;

export type NextOfKinRelationship = (typeof NEXT_OF_KIN_RELATIONSHIPS)[number];

export const nominateNextOfKinSchema = z.object({
  full_name: z.string().trim().min(2, "Enter their full name").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{10,15}$/, "Use the international format, e.g. +2348012345678"),
  relationship: z.enum(NEXT_OF_KIN_RELATIONSHIPS),
});

export type NominateNextOfKinInput = z.infer<typeof nominateNextOfKinSchema>;

/**
 * Relationships offered on the eldercare "manage" request wizard. A separate
 * list from NEXT_OF_KIN_RELATIONSHIPS because "grandparent" is common here
 * and rare there, and because free-text storage (care_access_requests.
 * relationship) makes the two lists cheap to keep distinct.
 */
export const ELDERCARE_RELATIONSHIPS = [
  "parent",
  "grandparent",
  "spouse",
  "sibling",
  "child",
  "other",
] as const;

export type EldercareRelationship = (typeof ELDERCARE_RELATIONSHIPS)[number];

/**
 * i_will_manage  the caller is the record owner asking someone else to take
 *                on 'manage' access over their own care — "I want my son to
 *                be able to book and manage things for me."
 * i_will_help    the caller is offering to be the manager of someone else's
 *                record — "I want to help manage my mother's care." Either
 *                way the record owner's own acceptance is what actually
 *                grants the access; see respond_to_care_access_request.
 */
export const CARE_ACCESS_REQUEST_DIRECTIONS = ["i_will_manage", "i_will_help"] as const;
export type CareAccessRequestDirection = (typeof CARE_ACCESS_REQUEST_DIRECTIONS)[number];

/**
 * The nine capabilities a "manage" grant can be scoped to
 * (public.caregiver_permission). Order here is the order they are offered in
 * the wizard and rendered as chips elsewhere — grouped by the everyday
 * errand they cover, not alphabetically.
 *
 * Leaving every box checked keeps today's behaviour exactly as it is:
 * createEldercareAccessRequestAction sends permissions = null (unrestricted)
 * whenever all nine are selected, same as every "manage" grant made before
 * this list existed. Unchecking one is what actually narrows it — this
 * constant is the client-side selection set, not the stored value.
 */
export const CAREGIVER_PERMISSIONS = [
  "view_appointments",
  "book_appointments",
  "view_medication",
  "manage_pharmacy",
  "view_results",
  "view_care_plan",
  "communicate_with_care_team",
  "manage_payments",
  "receive_alerts",
] as const;

export type CaregiverPermission = (typeof CAREGIVER_PERMISSIONS)[number];

export const CAREGIVER_PERMISSION_LABEL: Record<CaregiverPermission, string> = {
  view_appointments: "See appointments",
  // Also gates requesting a screening/lab check (sponsor_book_care) — there
  // is no separate "book a check" capability in this list, and both are the
  // same kind of action (scheduling care, not spending money or reading a
  // record), so the label says so rather than only naming the narrower half.
  book_appointments: "Book appointments and screening checks",
  view_medication: "See medications",
  manage_pharmacy: "Order and refill medication",
  view_results: "See test results",
  view_care_plan: "See the care plan",
  communicate_with_care_team: "Message the care team",
  manage_payments: "Pay bills",
  receive_alerts: "Be told when something needs attention",
};

/**
 * How long a grant lasts. "permanent" stores expires_at = null, matching
 * every grant made before temporary access existed; every other option is a
 * number of days, resolved to an absolute timestamp once, when the request
 * is sent (createEldercareAccessRequestAction), and carried unchanged from
 * there into the grant on acceptance (respond_to_care_access_request). A
 * request that sits unanswered eats into its own window rather than
 * starting the clock over on acceptance — the same "the offer itself has a
 * shelf life" behaviour as everything else about that request.
 */
export const CAREGIVER_ACCESS_DURATIONS = ["permanent", "7", "30", "90"] as const;
export type CaregiverAccessDuration = (typeof CAREGIVER_ACCESS_DURATIONS)[number];

export const CAREGIVER_ACCESS_DURATION_LABEL: Record<CaregiverAccessDuration, string> = {
  permanent: "Until I take it back",
  "7": "7 days",
  "30": "30 days",
  "90": "90 days",
};

export const eldercareAccessRequestSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{10,15}$/, "Use the international format, e.g. +2348012345678"),
  relationship: z.enum(ELDERCARE_RELATIONSHIPS),
  direction: z.enum(CARE_ACCESS_REQUEST_DIRECTIONS),
  // The selection set from the wizard, at least one required — a "manage"
  // grant with no capability at all authorises nothing and is never what
  // anyone means to send. createEldercareAccessRequestAction is what turns
  // "all nine selected" into permissions = null; this schema only validates
  // the selection itself.
  permissions: z.array(z.enum(CAREGIVER_PERMISSIONS)).min(1, "Choose at least one thing they can do"),
  duration: z.enum(CAREGIVER_ACCESS_DURATIONS),
});

export type EldercareAccessRequestInput = z.infer<typeof eldercareAccessRequestSchema>;

/**
 * care_access_requests.relationship is stored ONE way regardless of which
 * party filled the form: the COUNTERPARTY's relationship to the record OWNER
 * ("the counterparty is the owner's ___"). nominateNextOfKinAction already
 * asks the owner exactly that ("their relationship to you"), so it needs no
 * conversion. createEldercareAccessRequestAction's i_will_help direction asks
 * the opposite question — the CALLER (counterparty) describing the FOUND
 * person (owner)'s relationship to themselves — so it must invert what was
 * entered before storing, or "my parent asked to manage my care" would be
 * saved and later rendered back to the parent as "(your parent)".
 *
 * The same map runs the other way at render time: whoever is NOT the record
 * owner sees the inverse of the stored word, because the stored word was
 * always written from the owner's side.
 *
 * "grandchild" only exists here, never as a selectable option — nobody needs
 * to voluntarily label themselves someone's grandchild, but the word is
 * needed to render the inverse of a chosen "grandparent" correctly.
 */
const RELATIONSHIP_INVERSE: Record<string, string> = {
  parent: "child",
  child: "parent",
  grandparent: "grandchild",
  grandchild: "grandparent",
  spouse: "spouse",
  sibling: "sibling",
  other: "other",
};

export function inverseRelationship(relationship: string): string {
  return RELATIONSHIP_INVERSE[relationship] ?? relationship;
}
