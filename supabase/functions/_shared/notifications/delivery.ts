/**
 * Pure delivery rules for the notification sender (S13). No clock, network or database: the caller passes `now`
 * and the facts, so every branch is testable. Quiet hours and the daily cap are PROPOSED values read from
 * `notification_rules_config` (mirrored as `notifications.rules`); nothing here hard-codes them.
 */

export interface QuietSettings { readonly enabled: boolean; readonly start: string; readonly end: string }
export type Channel = "push" | "email" | "in_app" | "sms" | "voice";
export type Priority = "routine" | "critical";

/** Quiet hours are OFF until a person turns them on (founder decision 2026-10-13). Used when no rules row can be read. */
export const FALLBACK_QUIET: QuietSettings = { enabled: false, start: "21:00", end: "07:00" };

/**
 * THE one list of safety templates. They are never held by quiet hours, never counted against the daily push cap,
 * never folded into a digest and never blocked by a category opt-out, whatever `priority` the row was queued with (a
 * routine-priority row for one of these would otherwise be held overnight). They may still use generic wording
 * (discreet mode). Pattern families: any `*escalat*` (screening_escalated, vaccination_escalated,
 * vitals_monitoring_escalated, on_call_escalation), red_flag, red_event, on_call, clinician_alert, critical,
 * emergency_* (except emergency_card_*), abnormal_result_*, triage_recheck*, security.*, plus the exact keys
 * consult_join_ready (a live consultation waiting) and video_call_requested. The exact keys are asserted in
 * `s04b3-quiet-discreet.test.ts`, which also scans every sender template key.
 */
const SAFETY_TEMPLATE = /(^|_)(escalat[a-z]*|red_flag|red_event|on_call|clinician_alert|critical)(_|$)|^emergency_(?!card_)|^abnormal_result_|^triage_recheck|^security\.|^consult_join_ready$|^video_call_requested$/;
export function isSafetyCritical(template: string | null | undefined): boolean {
  return template != null && SAFETY_TEMPLATE.test(template);
}

const LAGOS_OFFSET_MIN = 60; // Africa/Lagos is UTC+1 all year, no daylight saving.

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m ?? 0);
};

/** When quiet hours end (epoch ms) if `nowMs` falls inside the window, else null. Handles a window that crosses midnight. */
export function quietUntil(nowMs: number, q: QuietSettings): number | null {
  if (!q.enabled) return null;
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  if (start === end) return null;
  const local = (((Math.floor(nowMs / 60000) + LAGOS_OFFSET_MIN) % 1440) + 1440) % 1440;
  const inside = start < end ? local >= start && local < end : local >= start || local < end;
  if (!inside) return null;
  const minutesToEnd = local < end ? end - local : 1440 - local + end;
  // Start of the current minute plus the wait, so the result lands exactly on the boundary.
  return Math.floor(nowMs / 60000) * 60000 + minutesToEnd * 60000;
}

export type Decision =
  | { readonly action: "send" }
  | { readonly action: "defer"; readonly until: number; readonly reason: "quiet_hours" }
  | { readonly action: "suppress"; readonly reason: "daily_cap" | "sms_not_allowed" }
  | { readonly action: "block"; readonly reason: "inv07"; readonly violations: readonly string[] };

export interface DecideInput {
  readonly channel: Channel;
  readonly priority: Priority;
  readonly nowMs: number;
  readonly quiet: QuietSettings;
  readonly routinePushSentToday: number;
  readonly routinePushPerDay: number;
  /**
   * Violations in the template's FIXED wording, from `lintRenderFn` (canary payload) or `lintText` on a stored
   * body. Never the rendered text: a patient called Sugar or a pharmacy called Heartland must not block a send.
   */
  readonly wordingViolations: readonly string[];
  /** Clinician paging by SMS is the one allowed non-code SMS (D-12); the caller says whether this row is that. */
  readonly isClinicianPage: boolean;
  /** `isSafetyCritical(template)`: skips quiet hours and the cap like a critical row does. */
  readonly safetyCritical?: boolean;
  /** The row has a `deferred_quiet` event: it was held by quiet hours and is now due, so the daily cap does not apply. */
  readonly previouslyHeld?: boolean;
}

/**
 * Order matters: a clinical word blocks everything, including a critical row (it is a wording bug, and the
 * escalation ladder still moves on a failed row); then critical rows skip quiet hours and the cap; then SMS that
 * is not a clinician page is refused (INV-08); then quiet hours; then the cap. In-app is never deferred or capped.
 */
export function decide(i: DecideInput): Decision {
  if (i.wordingViolations.length > 0) return { action: "block", reason: "inv07", violations: i.wordingViolations };
  if (i.channel === "sms" && !i.isClinicianPage) return { action: "suppress", reason: "sms_not_allowed" };
  if (i.priority === "critical" || i.safetyCritical === true || i.channel === "in_app" || i.channel === "sms" || i.channel === "voice") return { action: "send" };
  const until = quietUntil(i.nowMs, i.quiet);
  if (until !== null) return { action: "defer", until, reason: "quiet_hours" };
  // A row that quiet hours already held is sent once the window ends: the cap never turns a hold into a drop.
  if (i.channel === "push" && i.previouslyHeld !== true && i.routinePushSentToday >= i.routinePushPerDay) return { action: "suppress", reason: "daily_cap" };
  return { action: "send" };
}

/**
 * The envelope for a push. Discreet mode sends fixed words with no brand and no topic. A safety message keeps the
 * generic wording but says it is urgent, so it is not mistaken for something that can wait.
 */
export function pushEnvelope(discreet: boolean, body: string, maxChars = 160, urgent = false): { title: string; body: string } {
  if (discreet) return urgent ? { title: "Urgent message", body: "Open the app now." } : { title: "New message", body: "Open the app." };
  const trimmed = body.length > maxChars ? `${body.slice(0, maxChars - 1)}…` : body;
  return { title: "Tarragon Health", body: trimmed };
}

/**
 * The envelope for an email (S42, function 1.16). Discreet mode sends fixed words: no brand in the subject, no topic, no
 * link text from the template. A person on a shared phone sees "New message" and nothing else until they open the app.
 */
export function emailEnvelope(
  discreet: boolean,
  subject: string,
  html: string,
  text: string,
): { subject: string; html: string; text: string } {
  if (!discreet) return { subject, html, text };
  const line = "You have a new message. Open the app to read it.";
  return { subject: "New message", html: `<p>${line}</p>`, text: line };
}

export interface ExpoReceipt { readonly status?: string; readonly message?: string; readonly details?: { readonly error?: string } }
export type ReceiptOutcome = { readonly event: "delivered" } | { readonly event: "token_dead" } | { readonly event: "failed"; readonly reason: string };

/** An Expo receipt says the platform (APNs or FCM) accepted the message; it does not say anyone saw it. */
export function classifyExpoReceipt(r: ExpoReceipt | undefined): ReceiptOutcome | null {
  if (!r) return null; // not ready yet: ask again later
  if (r.status === "ok") return { event: "delivered" };
  if (r.details?.error === "DeviceNotRegistered") return { event: "token_dead" };
  return { event: "failed", reason: r.details?.error ?? r.message ?? "unknown" };
}

/**
 * Template audiences whose email goes to the row's own recipient, so that person's privacy choices apply. A positive
 * allow-list on purpose: lab, pharmacy, specialist, emergency-contact and broadcast (`patient_or_partner`) audiences,
 * unknown audiences and unregistered templates are all outside it, and their email never takes a patient's quiet
 * hours or discreet wording.
 */
export const PATIENT_AUDIENCES: ReadonlySet<string> = new Set(["patient", "patient_or_sponsor", "sponsor_and_patient", "sponsor", "patient_waitlisted"]);

export interface PrivacyInput {
  readonly role: string | null | undefined;
  readonly discreetFlag: boolean | undefined;
  /** False when the profile or settings lookup failed: wording is then made generic rather than guessed. */
  readonly known: boolean;
  readonly channel: Channel;
  /** `notification_templates.audience`; null or undefined when the lookup failed or the template has no row. */
  readonly audience: string | null | undefined;
  /** For email: true only when `payload.to_email` is the recipient's own address; null when that could not be checked. */
  readonly toEmailIsOwn: boolean | null;
}

/**
 * Which of a person's own privacy choices apply to a row. Quiet hours are a patient's own setting (a clinician is
 * never held back overnight). Discreet mode follows the profile flag; if the settings lookup failed (`known` false)
 * the wording is made generic rather than guessed.
 * A push goes only to the recipient's own devices, so it always takes the recipient's choices. An email can be
 * addressed to someone else (an email row always carries `payload.to_email`, and a lab or pharmacy alert has the
 * patient as `recipient_id`), so it takes them only when every check passes: a patient audience, a registered
 * template, and a `to_email` that is the recipient's own address. Any doubt means no patient privacy is applied.
 */
export function privacyFor(i: PrivacyInput): { quietApplies: boolean; discreet: boolean } {
  if (i.channel === "email" && !(i.audience != null && PATIENT_AUDIENCES.has(i.audience) && i.toEmailIsOwn === true)) {
    return { quietApplies: false, discreet: false };
  }
  return { quietApplies: i.known && i.role === "patient", discreet: !i.known || i.discreetFlag === true };
}

/** Templates whose email carries a document (an attachment) the patient can also open in the app. */
export const DISCREET_DOCUMENT_TEMPLATES: ReadonlySet<string> = new Set(["lab_order_requested_patient", "preventive_care_plan_updated"]);

/** The email a person in discreet mode receives instead of the template's own wording: no brand, topic or detail. */
export function discreetEmail(urgent: boolean, document = false): { subject: string; html: string; text: string } {
  if (document) {
    const text = "You have a new document. Open the app to read it.";
    return { subject: "New document", html: `<p>${text}</p>`, text };
  }
  const subject = urgent ? "Urgent message" : "New message";
  const text = urgent ? "You have an urgent message. Open the app now." : "You have a new message. Open the app to read it.";
  return { subject, html: `<p>${text}</p>`, text };
}
