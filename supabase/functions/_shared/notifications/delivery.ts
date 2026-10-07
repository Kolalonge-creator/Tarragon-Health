/**
 * Pure delivery rules for the notification sender (S13). No clock, network or database: the caller passes `now`
 * and the facts, so every branch is testable. Quiet hours and the daily cap are PROPOSED values read from
 * `notification_rules_config` (mirrored as `notifications.rules`); nothing here hard-codes them.
 */

export interface QuietSettings { readonly enabled: boolean; readonly start: string; readonly end: string }
export type Channel = "push" | "email" | "in_app" | "sms" | "voice";
export type Priority = "routine" | "critical";

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
  | { readonly action: "suppress"; readonly reason: "daily_cap" | "sms_not_allowed" | "sms_exception_off" }
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
  /** Why this row may use SMS at all (see `smsPurpose`). Anything but `clinician_page` or `emergency_contact` is refused. */
  readonly smsPurpose: SmsPurpose;
  /** The go-live guard `sms_emergency_contact_enabled`. Closed unless the sender positively read it as on. */
  readonly emergencyContactSmsOpen: boolean;
}

/**
 * SMS is allowed for exactly three things (D-12 plus the S85-D3 named exception): phone verification codes (sent by Supabase
 * phone auth, never through this queue), clinician paging, and one content-free alert to a patient's own consented emergency contact.
 * Through this queue only the last two exist.
 */
export type SmsPurpose = "clinician_page" | "emergency_contact" | "none";
export const EMERGENCY_CONTACT_TEMPLATE = "emergency_contact_alert";
export const EMERGENCY_CONTACT_SMS_GUARD_KEY = "sms_emergency_contact_enabled";

/**
 * A page is a CRITICAL row for a recipient whose account role is `clinician`. A critical row for a patient (a result notice on the
 * escalation ladder), a routine row for anyone, and an unknown role are all `none`: the old rule "any critical row may be texted"
 * let the ladder's last rung text a patient. The emergency-contact template is its own purpose whoever the recipient is.
 */
export function smsPurpose(i: { readonly template: string | null; readonly priority: Priority; readonly recipientRole: string | null | undefined }): SmsPurpose {
  if (i.template === EMERGENCY_CONTACT_TEMPLATE) return "emergency_contact";
  if (i.priority === "critical" && i.recipientRole === "clinician") return "clinician_page";
  return "none";
}

/**
 * Order matters: a clinical word blocks everything, including a critical row (it is a wording bug, and the
 * escalation ladder still moves on a failed row); then critical rows skip quiet hours and the cap; then SMS that
 * is not a clinician page or the guarded emergency-contact alert is refused (INV-08, D3); then quiet hours; then the cap. In-app is never deferred or capped.
 */
export function decide(i: DecideInput): Decision {
  if (i.wordingViolations.length > 0) return { action: "block", reason: "inv07", violations: i.wordingViolations };
  if (i.channel === "sms") {
    if (i.smsPurpose === "none") return { action: "suppress", reason: "sms_not_allowed" };
    if (i.smsPurpose === "emergency_contact" && !i.emergencyContactSmsOpen) return { action: "suppress", reason: "sms_exception_off" };
  }
  // An alert the patient raised themselves is never held overnight or counted against the daily cap, same as a critical row.
  if (i.priority === "critical" || i.smsPurpose === "emergency_contact" || i.channel === "in_app" || i.channel === "sms" || i.channel === "voice") return { action: "send" };
  const until = quietUntil(i.nowMs, i.quiet);
  if (until !== null) return { action: "defer", until, reason: "quiet_hours" };
  if (i.channel === "push" && i.routinePushSentToday >= i.routinePushPerDay) return { action: "suppress", reason: "daily_cap" };
  return { action: "send" };
}

/** The envelope for a push. Discreet mode sends fixed words with no brand and no topic. */
export function pushEnvelope(discreet: boolean, body: string, maxChars = 160): { title: string; body: string } {
  if (discreet) return { title: "New message", body: "Open the app." };
  const trimmed = body.length > maxChars ? `${body.slice(0, maxChars - 1)}…` : body;
  return { title: "Tarragon Health", body: trimmed };
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
