// Tarragon Health — notification send layer (Phase 1)
//
// Consumes `notifications` rows queued by the Sprint 2/3 reminder cron jobs
// (queue_vitals_reminders, queue_medication_refill_reminders,
// queue_booking_reminders). Invoked every
// 5 minutes by pg_cron + pg_net (see the schedule_notification_sender
// migration) — not the abnormal-result path, which needs its own
// trigger-invoked, 60-second-SLA handler (docs/ARCHITECTURE.md §7). Also
// nudged immediately (fire-and-forget net.http_post) by
// private.enqueue_critical_notification() and
// private.escalate_unconfirmed_critical_notifications()
// (critical_notification_engine.sql) so a critical row's first attempt and
// every escalation hop don't wait out the 5-minute cron tick.
//
// Mirrors packages/shared/src/ml-client.ts: every external call has a
// timeout and never throws past its boundary. Missing credentials degrade
// each affected row to `failed` with a clear `last_error`, never a crash
// and never a silently-stuck `pending` row forever.
//
// Channel priority: push is the default first channel platform-wide
// (a legacy chat channel was removed, founder decision F-02 — the channels
// are in-app, push and email; SMS remains for verification codes and
// clinician paging). The difference between the two priorities is what
// happens when push fails to SEND (not "goes unopened" — that's the
// escalation engine's job, not this function's): routine rows fall back
// inline to sms within this same pass (simple best-effort delivery, no
// confirmation tracking needed); critical rows do NOT — a critical row's
// failed send is picked up by
// private.escalate_unconfirmed_critical_notifications() and turned into a
// new, separately-tracked notification on the next ladder channel, so every
// hop stays its own auditable, delivery-tracked row.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { appUrl, substituteTemplatePlaceholders, TEMPLATE_MAP } from "./templates.ts";
import type { TemplateRender } from "./templates.ts";
import { describeViolations, lintRenderFn, lintText } from "../_shared/notifications/neutral.ts";
import { decide, DISCREET_DOCUMENT_TEMPLATES, discreetEmail, expoUrgencyFields, FALLBACK_QUIET, isClinicianPageRow, isSafetyCritical, PATIENT_AUDIENCES, privacyFor, pushEnvelope, signDocumentLink, withDocumentLink } from "../_shared/notifications/delivery.ts";
import type { DocumentLinkKind } from "../_shared/notifications/delivery.ts";
import type { QuietSettings } from "../_shared/notifications/delivery.ts";
import { withSentry } from "../_shared/observability/sentry.ts";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const EXTERNAL_TIMEOUT_MS = 5_000;
// Push notification bodies are shown in a compact OS tray — trim the
// (often multi-sentence) smsText down to something that reads cleanly there.
const PUSH_BODY_MAX_CHARS = 160;


interface NotificationRow {
  id: string;
  recipient_id: string;
  organisation_id: string | null;
  channel: "sms" | "in_app" | "email" | "push" | "voice";
  template: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  priority: "routine" | "critical";
}

// Spec §76.12 (patient channel preferences). patient_notification_preferences
// (20260829222502) has no `category` column on `notifications` itself to key
// off — categorising by template here, purely additive, needs no schema
// change to `notifications`. A template with no entry is simply never gated
// (always sends, today's behaviour unchanged) — the safe default for
// anything not confidently classified, rather than guessing. Never includes
// a template addressed to someone other than the patient (a lab/pharmacy/
// specialist contact, or an emergency contact) or an admin-authored
// broadcast — see the per-line comments where those are deliberately
// omitted below.
type PreferenceCategory =
  | "appointments"
  | "medications"
  | "labs_results"
  | "screenings_vaccinations"
  | "referrals"
  | "care_messages"
  | "education_wellness"
  | "billing"
  | "reputation_requests";

const TEMPLATE_CATEGORY: Partial<Record<string, PreferenceCategory>> = {
  booking_reminder: "appointments",
  video_consult_booked: "appointments",
  video_visit_alternate_proposed: "appointments",
  video_visit_declined: "appointments",
  annual_review_consult_scheduled: "appointments",

  medication_refill_reminder: "medications",
  medication_adherence_checkin: "medications",
  medication_review_due: "medications",
  medication_prescribed_patient: "medications",
  prescription_updated_patient: "medications",
  pharmacy_order_patient_confirmation: "medications",
  medication_dose_reminder: "medications",

  lab_order_patient_confirmation: "labs_results",
  lab_order_requested_patient: "labs_results",
  risk_signal_attention: "labs_results",

  vaccination_due: "screenings_vaccinations",
  vaccination_verified: "screenings_vaccinations",
  screening_due: "screenings_vaccinations",
  preventive_care_plan_updated: "screenings_vaccinations",
  health_check_due_soon: "screenings_vaccinations",
  diabetes_complication_check_due: "screenings_vaccinations",
  preventive_review_due: "screenings_vaccinations",
  annual_review_due: "screenings_vaccinations",

  referral_patient_confirmation: "referrals",

  new_care_message: "care_messages",
  // S22 written questions and note release (patient-addressed only; the clinician-addressed ones stay ungated).
  // Two-tier monthly follow-up (patient-addressed only)
  followup_times_offered: "appointments",
  followup_offer_withdrawn: "appointments",
  followup_month_missed: "appointments",
  written_question_received: "care_messages",
  written_question_answered: "care_messages",
  written_question_info_needed: "care_messages",
  written_question_window_missed: "care_messages",
  written_question_call_planned: "care_messages",
  note_released: "care_messages",
  note_release_declined: "care_messages",
  note_correction_answered: "care_messages",
  care_outreach_checkin: "care_messages",
  sponsor_care_reviewed: "care_messages",
  sponsor_person_quiet: "care_messages",
  sponsored_plan_started: "care_messages",

  vitals_reminder: "education_wellness",
  vitals_monitoring_due: "education_wellness",
  vitals_monitoring_overdue: "education_wellness",
  vitals_monitoring_escalated: "education_wellness",
  lifestyle_nudge: "education_wellness",
  lifestyle_review_due: "education_wellness",
  wellness_challenge_ending: "education_wellness",
  region_now_available: "education_wellness",
  // Patient Engagement Engine (see private.queue_engagement_interventions) —
  // same bucket as the other keep-up-with-your-care nudges above, rather than
  // a dedicated engagement preferences table.
  engagement_reminder_personalized: "education_wellness",
  engagement_support_offer: "education_wellness",
  engagement_alternative_channel_checkin: "education_wellness",

  sponsor_spend_receipt: "billing",
  sponsor_monthly_report: "billing",

  reputation_review_request_trustpilot: "reputation_requests",

  // Deliberately NOT categorised (never gated by this table, always sends):
  // broadcast_announcement (admin-authored, org-wide — a category toggle
  // must never silently drop it); emergency_contact_alert/emergency_
  // followup/emergency_card_viewed/emergency_card_expiring_soon (safety-
  // adjacent); abnormal_result_clinician_alert/emergency_event_clinician_
  // alert/vitals_red_flag_clinician_alert/pharmacy_order_pharmacy_alert/
  // lab_order_lab_alert/referral_specialist_alert (recipient_id is the
  // patient for bookkeeping only — the content is addressed to a
  // clinician/partner/emergency contact, not the patient, same nuance
  // 20260811235133_guarantee_in_app_notification_companions.sql documents).
};

// Spec §76.14 (notification fatigue management). More than this many
// ROUTINE (never critical) rows queued for the same recipient in one batch
// collapse into a single in-app digest instead of arriving as separate
// pushes/texts/emails. 3 is a small, deliberately conservative threshold —
// "avoid reminder overload", not "batch everything".
const DIGEST_THRESHOLD = 3;

interface PushSubscriptionRow {
  id: string;
  platform: "web" | "ios" | "android";
  endpoint: string | null;
  p256dh_key: string | null;
  auth_key: string | null;
  expo_push_token: string | null;
}

// Narrowed shapes sendWebPush/sendExpoPush actually operate on, so neither
// helper has to null-check fields the DB's push_subscriptions_shape_check
// constraint already guarantees are present for that platform.
interface WebPushSubscription {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

interface NativePushSubscription {
  id: string;
  expo_push_token: string;
}

function isWebPushSubscription(sub: PushSubscriptionRow): sub is PushSubscriptionRow & WebPushSubscription {
  return sub.platform === "web" && sub.endpoint !== null && sub.p256dh_key !== null && sub.auth_key !== null;
}

function isNativePushSubscription(sub: PushSubscriptionRow): sub is PushSubscriptionRow & NativePushSubscription {
  return (sub.platform === "ios" || sub.platform === "android") && sub.expo_push_token !== null;
}

interface SendResult {
  ok: boolean;
  error?: string;
  // Provider-side message id, when a provider returns one worth storing.
  // Nothing currently produces one (web push has no per-message receipt to
  // correlate).
  messageId?: string;
}

/** Never throws — resolves { ok: false } on timeout, network error, or non-2xx. */
async function withExternalCall(
  fn: (signal: AbortSignal) => Promise<Response>,
): Promise<SendResult & { response?: Response }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    const res = await fn(controller.signal);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, response: res };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function sendTermiiSms(
  toPhone: string,
  text: string,
): Promise<SendResult> {
  const apiKey = Deno.env.get("TERMII_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "TERMII_API_KEY not configured" };
  }

  return withExternalCall((signal) =>
    fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        to: toPhone,
        from: "Tarragon",
        sms: text,
        type: "plain",
        channel: "generic",
      }),
    })
  );
}

/**
 * Termii's Voice Call API — same /api/sms/send endpoint as sendTermiiSms,
 * with channel: 'voice' instead of 'generic'. Termii converts the `sms`
 * field to speech and places a phone call rather than sending a text.
 * Built for private.remap_notification_channel() (2026-07-23), which
 * transparently turns a queued reminder row into 'voice' at insert time
 * for a patient with profiles.preferred_reminder_channel = 'voice' — no
 * producer function needs to know voice exists.
 */
async function sendTermiiVoiceCall(
  toPhone: string,
  text: string,
): Promise<SendResult> {
  const apiKey = Deno.env.get("TERMII_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "TERMII_API_KEY not configured" };
  }

  return withExternalCall((signal) =>
    fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        to: toPhone,
        from: "Tarragon",
        sms: text,
        type: "plain",
        channel: "voice",
      }),
    })
  );
}

/**
 * Web Push (RFC 8030/8291/8292 — VAPID). VAPID keys are a self-signed
 * application identity, not a third-party account credential, so unlike
 * TERMII_API_KEY/RESEND_API_KEY there is no provider account
 * to wait on — these were generated directly for this build.
 *
 * Fans out to every active subscription the recipient has (phone + desktop,
 * etc.) and treats the notification as sent if ANY of them accepts it.
 * Reports back which subscriptions the push service says are gone (404/410
 * — the browser revoked or expired them) so the caller can disable those
 * rows rather than retrying them forever.
 */
async function sendWebPush(
  subscriptions: WebPushSubscription[],
  payload: { title: string; body: string; url: string; notificationId: string },
): Promise<SendResult & { goneSubscriptionIds: string[] }> {
  if (subscriptions.length === 0) {
    return { ok: false, error: "no active push subscription", goneSubscriptionIds: [] };
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) {
    return { ok: false, error: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not configured", goneSubscriptionIds: [] };
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const body = JSON.stringify(payload);
  const goneSubscriptionIds: string[] = [];
  let anyOk = false;
  let lastError: string | undefined;

  for (const sub of subscriptions) {
    const timeout = new Promise<{ timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), EXTERNAL_TIMEOUT_MS)
    );
    try {
      const send = webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
        body,
        { TTL: 300 },
      ).then(() => ({ timedOut: false as const }));
      const outcome = await Promise.race([send, timeout]);
      if (outcome.timedOut) {
        lastError = "timeout";
        continue;
      }
      anyOk = true;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        goneSubscriptionIds.push(sub.id);
      }
      lastError = err instanceof Error ? err.message : "unknown error";
    }
  }

  return anyOk
    ? { ok: true, goneSubscriptionIds }
    : { ok: false, error: lastError ?? "push send failed", goneSubscriptionIds };
}

/**
 * Expo push (https://exp.host/--/api/v2/push/send) — the native (iOS/Android)
 * counterpart to sendWebPush. Same contract: one batched call for every
 * device token the recipient has, ok if any ticket isn't an error, and any
 * ticket reporting DeviceNotRegistered goes into goneSubscriptionIds for the
 * same disabled_at cleanup sendWebPush's caller already does. Expo accepts
 * an array of messages in a single call (no per-token round trip needed),
 * and returns tickets in the same order as the request array.
 */
async function sendExpoPush(
  subscriptions: NativePushSubscription[],
  payload: { title: string; body: string; url: string; notificationId: string },
  urgent = false,
): Promise<SendResult & { goneSubscriptionIds: string[]; tickets?: Array<{ id: string; subscriptionId: string }> }> {
  if (subscriptions.length === 0) {
    return { ok: false, error: "no active push subscription", goneSubscriptionIds: [] };
  }

  const messages = subscriptions.map((sub) => ({
    to: sub.expo_push_token,
    title: payload.title,
    body: payload.body,
    data: { url: payload.url, notificationId: payload.notificationId },
    // S13 R4: safety rows are high priority, on the urgent Android channel, time-sensitive on iPhone (critical only once Apple's
    // entitlement is granted and IOS_CRITICAL_ALERTS_ENABLED is set). Routine rows add nothing here.
    ...expoUrgencyFields(urgent, Deno.env.get("IOS_CRITICAL_ALERTS_ENABLED") === "true"),
  }));

  const result = await withExternalCall((signal) =>
    fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    })
  );

  if (!result.ok || !result.response) {
    return { ok: false, error: result.error ?? "expo push send failed", goneSubscriptionIds: [] };
  }

  type ExpoTicket = { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } };
  let tickets: ExpoTicket[];
  try {
    const json = (await result.response.json()) as { data?: ExpoTicket[] };
    tickets = json.data ?? [];
  } catch {
    return { ok: false, error: "invalid expo push response", goneSubscriptionIds: [] };
  }

  const goneSubscriptionIds: string[] = [];
  const okTickets: Array<{ id: string; subscriptionId: string }> = [];
  let anyOk = false;
  let lastError: string | undefined;
  tickets.forEach((ticket, i) => {
    if (ticket.status === "ok") {
      anyOk = true;
      // S13: an Expo ticket only says Expo accepted the message; the receipt (checked later by
      // expo-push-receipts) says whether APNs or FCM did, and reports a dead token.
      if (ticket.id) okTickets.push({ id: ticket.id, subscriptionId: subscriptions[i].id });
      return;
    }
    lastError = ticket.message ?? "expo push ticket error";
    if (ticket.details?.error === "DeviceNotRegistered") {
      goneSubscriptionIds.push(subscriptions[i].id);
    }
  });

  return anyOk
    ? { ok: true, goneSubscriptionIds, tickets: okTickets }
    : { ok: false, error: lastError ?? "expo push send failed", goneSubscriptionIds };
}

/** One file attached to an outbound email. `content` is base64, matching
 * Resend's `attachments` field shape exactly — see sendEmail below. */
interface EmailAttachment {
  filename: string;
  content: string;
}

async function sendEmail(
  toEmail: string,
  subject: string,
  html: string,
  text: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  // Sender must be a verified domain in the Resend account. Falls back to a
  // sensible default so a misconfigured RESEND_FROM degrades to one clear
  // Resend error rather than a crash.
  const from = Deno.env.get("RESEND_FROM") ??
    "Tarragon Health <notifications@tarragonhealth.com>";

  const result = await withExternalCall((signal) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [toEmail],
        subject,
        html,
        text,
        // Omitted entirely rather than sent as [] when there is nothing to
        // attach — an empty array is harmless to Resend, but omitting it
        // keeps every other email's request body byte-identical to before
        // this change, which matters given how easily this function has
        // drifted from source in the past (see CLAUDE.md's standing note).
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }),
    })
  );
  if (!result.ok || !result.response) return { ok: false, error: result.error };
  // S13: Resend answers { id }. Storing it as provider_message_id is what lets the resend-webhook find this row.
  try {
    const body = (await result.response.json()) as { id?: unknown };
    return { ok: true, messageId: typeof body.id === "string" ? body.id : undefined };
  } catch {
    return { ok: true };
  }
}

/**
 * OQ-91 (decided option b): the lab request and the care plan used to ride along as PDF attachments that name the request
 * (test names, plan items), so a mail preview or a forwarded mailbox could show them. The email now carries one sentence and
 * a signed link. The link holds a document id and an HMAC signature, no name and no test; the web route checks the
 * signature and the expiry, then makes the person sign in, and the existing in-app PDF route checks ownership.
 * Without NOTIFICATIONS_LINK_SECRET the email goes without a link (the in-app copy stands), never with an unsigned one.
 */
const DOCUMENT_LINK_TTL_MS = 7 * 24 * 3_600_000;
async function documentLinkFor(template: string | null, recipientId: string, payload: Record<string, unknown>): Promise<string | null> {
  const secret = Deno.env.get("NOTIFICATIONS_LINK_SECRET");
  if (!secret) {
    console.error("document link: NOTIFICATIONS_LINK_SECRET not configured; the email goes without a link");
    return null;
  }
  let kind: DocumentLinkKind;
  let id: string;
  if (template === "lab_order_requested_patient" && typeof payload.order_id === "string") {
    kind = "lab-request";
    id = payload.order_id;
  } else if (template === "preventive_care_plan_updated") {
    kind = "care-plan";
    id = recipientId;
  } else {
    return null;
  }
  const base = Deno.env.get("APP_BASE_URL") ?? "https://app.tarragonhealth.ng";
  return `${base}/d/${await signDocumentLink(secret, kind, id, Date.now() + DOCUMENT_LINK_TTL_MS)}`;
}

Deno.serve(withSentry("send-pending-notifications", async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // send_after (set by queue_vitals_reminders/queue_medication_checkin_reminders
  // from profiles.preferred_reminder_hour) holds a non-urgent reminder back
  // until the patient's preferred local hour — null means "send on next tick"
  // as before. Never set on critical/escalation rows, so this can never delay one.
  const { data: pending, error: fetchError } = await supabase
    .from("notifications")
    .select("id, recipient_id, organisation_id, channel, template, payload, attempts, priority")
    .eq("status", "pending")
    .in("channel", ["sms", "email", "voice", "push"])
    .lt("attempts", MAX_ATTEMPTS)
    .or(`send_after.is.null,send_after.lte.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE)
    .returns<NotificationRow[]>();

  if (fetchError) {
    return Response.json(
      { processed: 0, sent: 0, retried: 0, failed: 0, suppressed: 0, error: fetchError.message },
      { status: 200 },
    );
  }

  const rows = pending ?? [];
  if (rows.length === 0) {
    return Response.json({ processed: 0, sent: 0, retried: 0, failed: 0, suppressed: 0, deferred: 0 });
  }

  const recipientIds = [...new Set(rows.map((row) => row.recipient_id))];
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, phone, role, discreet_mode")
    .in("id", recipientIds)
    .returns<Array<{ id: string; phone: string | null; role: string | null; discreet_mode: boolean | null }>>();
  const phoneById = new Map((profiles ?? []).map((p) => [p.id, p.phone]));
  const roleById = new Map((profiles ?? []).map((p) => [p.id, p.role]));
  const discreetById = new Map((profiles ?? []).map((p) => [p.id, p.discreet_mode === true]));

  // S13: PROPOSED rules (versioned in notification_rules_config) and each recipient's own quiet hours.
  const { data: rulesRow, error: rulesError } = await supabase
    .from("notification_rules_config")
    .select("config")
    .eq("is_active", true)
    .maybeSingle<{ config: { quietHours?: { enabled?: boolean; start?: string; end?: string }; routinePushPerDay?: number } }>();
  if (rulesError) console.error("send-pending-notifications: rules config unreadable; quiet hours fall back to off", rulesError.message);
  const defaultQuiet: QuietSettings = {
    enabled: rulesRow?.config.quietHours?.enabled ?? FALLBACK_QUIET.enabled,
    start: rulesRow?.config.quietHours?.start ?? FALLBACK_QUIET.start,
    end: rulesRow?.config.quietHours?.end ?? FALLBACK_QUIET.end,
  };
  const routinePushPerDay = rulesRow?.config.routinePushPerDay ?? 4;
  const { data: settingRows, error: settingsError } = await supabase
    .from("notification_settings")
    .select("profile_id, quiet_enabled, quiet_start, quiet_end")
    .in("profile_id", recipientIds)
    .returns<Array<{ profile_id: string; quiet_enabled: boolean; quiet_start: string; quiet_end: string }>>();
  // Fail closed for routine email and push rows: without the recipient's role, discreet choice and quiet hours the
  // sender cannot honour them, so this pass pushes them back five minutes (see the loop) and tries again; nothing is
  // lost or sent with the wrong wording. Critical and safety rows still go, and where discreet is unknown a patient's
  // push or email goes out generic, which can cost a critical email its detail but never loses the alert.
  const { data: audienceRows, error: audienceError } = await supabase
    .from("notification_templates")
    .select("key, audience")
    .in("key", [...new Set(rows.map((r) => r.template).filter((t): t is string => typeof t === "string"))])
    .returns<Array<{ key: string; audience: string | null }>>();
  const audienceByTemplate = new Map((audienceRows ?? []).map((t) => [t.key, t.audience]));
  if (audienceError) console.error("send-pending-notifications: template audience lookup failed; partner exemption unavailable this pass", audienceError.message);
  const settingsDegraded = Boolean(profilesError || settingsError);
  if (settingsDegraded) {
    console.error("send-pending-notifications: privacy settings lookup failed; only critical and safety rows go this pass", (profilesError ?? settingsError)!.message);
  }
  const quietById = new Map<string, QuietSettings>(
    (settingRows ?? []).map((r) => [r.profile_id, { enabled: r.quiet_enabled, start: r.quiet_start.slice(0, 5), end: r.quiet_end.slice(0, 5) }]),
  );
  const { data: pushToday } = await supabase
    .from("notifications")
    .select("recipient_id, template")
    .eq("channel", "push")
    .eq("priority", "routine")
    .eq("status", "sent")
    .gte("sent_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
    .in("recipient_id", recipientIds)
    .returns<Array<{ recipient_id: string; template: string | null }>>();
  const pushSentToday = new Map<string, number>();
  for (const r of pushToday ?? []) if (!isSafetyCritical(r.template)) pushSentToday.set(r.recipient_id, (pushSentToday.get(r.recipient_id) ?? 0) + 1);

  // Rows that quiet hours already held (a deferred_quiet event): once due they are sent, the daily cap does not apply.
  const { data: heldRows, error: heldError } = await supabase
    .from("notification_delivery_events")
    .select("notification_id")
    .eq("event", "deferred_quiet")
    .in("notification_id", rows.map((r) => r.id))
    .returns<Array<{ notification_id: string }>>();
  if (heldError) console.error("send-pending-notifications: held-row lookup failed; the daily cap may apply to released rows this pass", heldError.message);
  const previouslyHeldIds = new Set((heldRows ?? []).map((h) => h.notification_id));

  // Third-party addressing check for email: is payload.to_email the recipient's own sign-in address? Unknown counts as no.
  const ownEmailCache = new Map<string, string | null>();
  const emailIsOwn = async (recipientId: string, toEmail: unknown): Promise<boolean | null> => {
    if (typeof toEmail !== "string") return null;
    if (!ownEmailCache.has(recipientId)) {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(recipientId);
        ownEmailCache.set(recipientId, error ? null : (data.user?.email ?? null));
      } catch (_e) {
        ownEmailCache.set(recipientId, null);
      }
    }
    const own = ownEmailCache.get(recipientId);
    return own == null ? null : own.toLowerCase() === toEmail.toLowerCase();
  };
  const pushedBackIds: string[] = [];

  // Append only record of what happened to a notification. Never throws: tracking must not change a send.
  const recordEvent = async (
    notificationId: string,
    event: string,
    provider: string | null,
    providerRef: string | null,
    detail: Record<string, unknown> = {},
  ): Promise<void> => {
    try {
      await supabase.rpc("record_notification_delivery_event", {
        p_notification_id: notificationId,
        p_event: event,
        p_provider: provider,
        p_provider_ref: providerRef,
        p_detail: detail,
      });
    } catch (_e) {
      // best effort
    }
  };
  // Wording check per template, cached: renders with a canary payload so a clinical placeholder is caught by name.
  const wordingCache = new Map<string, string[]>();
  const wordingViolationsFor = (template: string | null, channel: string, bodyFromDb?: { subject: string | null; body: string }): string[] => {
    const key = `${template}:${channel}`;
    const hit = wordingCache.get(key);
    if (hit) return hit;
    let out: string[] = [];
    const fn = template ? TEMPLATE_MAP[template] : undefined;
    if (fn) out = describeViolations(lintRenderFn((pl) => fn(pl, { notificationId: "lint", recipientId: "lint" })));
    else if (bodyFromDb) out = describeViolations(lintText(`${bodyFromDb.subject ?? ""} ${bodyFromDb.body}`));
    wordingCache.set(key, out);
    return out;
  };
  let deferred = 0;

  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, profile_id, platform, endpoint, p256dh_key, auth_key, expo_push_token")
    .in("profile_id", recipientIds)
    .is("disabled_at", null)
    .returns<Array<PushSubscriptionRow & { profile_id: string }>>();
  const subscriptionsByProfile = new Map<string, PushSubscriptionRow[]>();
  for (const sub of subscriptions ?? []) {
    const list = subscriptionsByProfile.get(sub.profile_id) ?? [];
    list.push(sub);
    subscriptionsByProfile.set(sub.profile_id, list);
  }

  // Spec §76.12 — patient channel preferences, routine rows only. Keyed
  // "recipientId:category" since patient_notification_preferences is one row
  // per (patient, category); a missing row means "all channels on"
  // (the table's own column defaults), so an absent lookup below always
  // falls through to "send".
  const { data: preferenceRows } = await supabase
    .from("patient_notification_preferences")
    .select("patient_id, category, email_enabled, sms_enabled, push_enabled")
    .in("patient_id", recipientIds)
    .returns<
      Array<{
        patient_id: string;
        category: PreferenceCategory;
        email_enabled: boolean;
        sms_enabled: boolean;
        push_enabled: boolean;
      }>
    >();
  const preferenceByRecipientCategory = new Map(
    (preferenceRows ?? []).map((p) => [`${p.patient_id}:${p.category}`, p]),
  );

  // S13b: which message an email nudge stands in for (its category decides whether the patient allows email).
  const nudgeSources = rows
    .filter((row) => row.template === "push_unconfirmed_email_nudge" && typeof row.payload?.fallback_for === "string")
    .map((row) => String(row.payload.fallback_for));
  const originalTemplateById = new Map<string, string | null>();
  if (nudgeSources.length > 0) {
    const { data: originals } = await supabase
      .from("notifications").select("id, template").in("id", nudgeSources)
      .returns<Array<{ id: string; template: string | null }>>();
    for (const o of originals ?? []) originalTemplateById.set(o.id, o.template);
  }

  // SMS (Termii sender-ID approval) is off the founder's near-term plan
  // (CLAUDE.md, 2026-09-15) and had a confirmed 0% live success rate as of
  // 2026-09-18 — every attempt is a guaranteed failure against a real
  // provider, for no patient benefit, that also pollutes the
  // failure/reconciliation data with noise indistinguishable from a
  // genuine outage. Routine rows on this channel are suppressed before
  // ever reaching the provider call. Critical rows are deliberately
  // UNAFFECTED — private.escalate_unconfirmed_critical_notifications()
  // depends on a real, timely `failed` status to advance push -> email
  // -> sms -> exhausted, and channelAllowed() already never gates a
  // critical row for any reason; this must stay that way.
  function platformDisabledChannel(row: NotificationRow): boolean {
    if (row.priority === "critical") return false;
    return row.channel === "sms";
  }

  function channelAllowed(row: NotificationRow): boolean {
    if (row.priority === "critical" || isSafetyCritical(row.template)) return true; // never gated — see TEMPLATE_CATEGORY's header comment
    // S13b: the email nudge after an unopened push follows the patient's email choice for the ORIGINAL message's category.
    const effectiveTemplate = row.template === "push_unconfirmed_email_nudge"
      ? originalTemplateById.get(String(row.payload?.fallback_for ?? "")) ?? null
      : row.template;
    const category = effectiveTemplate ? TEMPLATE_CATEGORY[effectiveTemplate] : undefined;
    if (!category) return true; // unclassified templates are never gated
    const pref = preferenceByRecipientCategory.get(`${row.recipient_id}:${category}`);
    if (!pref) return true; // no row on file — table defaults are all-on
    switch (row.channel) {
      case "email":
        return pref.email_enabled;
      case "sms":
        return pref.sms_enabled;
      case "push":
        return pref.push_enabled;
      default:
        return true; // voice has no toggle column — treat as always-on
    }
  }

  let sent = 0;
  let retried = 0;
  let failed = 0;
  let suppressed = 0;

  const suppress = (id: string, reason: string) =>
    supabase
      .from("notifications")
      .update({ status: "suppressed", last_error: reason })
      .eq("id", id);

  // Spec §76.14 — fatigue management. More than DIGEST_THRESHOLD routine
  // rows for the same recipient in this one batch fold into a single in-app
  // digest; the individual rows never send on their own external channel.
  // Critical rows are never eligible — they're excluded from `routineByRecipient`
  // below by construction (only priority === "routine" rows are grouped).
  const routineByRecipient = new Map<string, NotificationRow[]>();
  for (const row of rows) {
    // S03b: a security notice (sign-in recovery, the sign-in number) is never folded into a digest. They are queued 'routine' on
    // purpose (a 'critical' row is re-sent by SMS), but folding would drop the EMAIL half exactly when several steps happen quickly,
    // which is when the owner most needs it.
    if (typeof row.template === "string" && row.template.startsWith("security.")) continue;
    // Safety messages are never folded away, and neither is a reminder quiet hours already held: it is sent once.
    // If the held-row lookup failed nothing is folded this pass, so a released reminder cannot be folded away for good.
    if (heldError || row.priority !== "routine" || isSafetyCritical(row.template) || previouslyHeldIds.has(row.id)) continue;
    const list = routineByRecipient.get(row.recipient_id) ?? [];
    list.push(row);
    routineByRecipient.set(row.recipient_id, list);
  }

  const foldedIds = new Set<string>();
  for (const [recipientId, group] of routineByRecipient) {
    if (group.length <= DIGEST_THRESHOLD) continue;

    const labels = group.map((row) => {
      const renderFn = row.template ? TEMPLATE_MAP[row.template] : undefined;
      return renderFn
        ? renderFn(row.payload ?? {}, { notificationId: row.id, recipientId: row.recipient_id }).smsText
        : (row.template ?? "an update");
    });

    const { error: digestError } = await supabase.from("notifications").insert({
      recipient_id: recipientId,
      organisation_id: group[0].organisation_id,
      channel: "in_app",
      status: "pending",
      priority: "routine",
      template: "daily_digest",
      payload: { count: group.length, items: labels, action_centre_url: appUrl("/patient/actions") },
    });
    if (digestError) continue; // couldn't create the digest — leave the originals to send normally, don't silently drop them

    for (const row of group) {
      await suppress(row.id, `folded into daily_digest (${group.length} items)`);
      foldedIds.add(row.id);
      suppressed++;
    }
  }

  // Only email and push depend on the privacy lookups (SMS, voice and in-app ignore quiet hours and discreet mode).
  // An email also needs the template audience: if that lookup failed, a routine email waits rather than going out unsure.
  // Those rows are pushed back five minutes BEFORE any send, so a crash or timeout later cannot leave them at the front
  // of every batch to starve newer rows.
  for (const row of rows) {
    const needsPrivacy = row.channel === "push" || row.channel === "email";
    // A failed held-row lookup also waits: without it a released reminder could be capped or folded away for good.
    if (!foldedIds.has(row.id) && (settingsDegraded || heldError || (audienceError && row.channel === "email")) && needsPrivacy && row.priority !== "critical" && !isSafetyCritical(row.template)) {
      pushedBackIds.push(row.id);
    }
  }
  if (pushedBackIds.length > 0) {
    const { error: pushBackError } = await supabase
      .from("notifications")
      .update({ send_after: new Date(Date.now() + 5 * 60_000).toISOString() })
      .in("id", pushedBackIds)
      .eq("status", "pending");
    if (pushBackError) console.error("send-pending-notifications: could not push back skipped rows", pushBackError.message);
  }
  const pushedBackSet = new Set(pushedBackIds);

  for (const row of rows) {
    if (foldedIds.has(row.id) || pushedBackSet.has(row.id)) continue;

    // A failed profile lookup means the recipient's role is unknown, and the SMS rule is decided by role. Leave an SMS row for the next
    // pass (never settle it as suppressed on a guess): a staff page must not be lost to a one-off read error.
    if (row.channel === "sms" && profilesError) continue;
    if (platformDisabledChannel(row)) {
      await suppress(row.id, "sms deprioritised platform-wide, no provider approval yet");
      suppressed++;
      continue;
    }
    if (!channelAllowed(row)) {
      await suppress(row.id, "patient turned off this channel for this category");
      suppressed++;
      continue;
    }
    // Critical rows fail fast, never sit through the normal 3-attempt/
    // ~15-minute retry ladder — private.escalate_unconfirmed_critical_notifications()
    // (checked every 2 minutes) is what turns a failed critical send into
    // the next channel's tracked row, so a quick, definite `failed` here
    // matters more than a slow retry that just delays the real fallback.
    const isCritical = row.priority === "critical";

    const markSent = (providerMessageId?: string) =>
      supabase
        .from("notifications")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
        })
        .eq("id", row.id);

    const markFailed = (lastError: string) =>
      supabase
        .from("notifications")
        .update({
          status: "failed",
          attempts: row.attempts + 1,
          last_error: lastError,
          failed_at: new Date().toISOString(),
        })
        .eq("id", row.id);

    const markRetry = (lastError: string) =>
      supabase
        .from("notifications")
        .update({ attempts: row.attempts + 1, last_error: lastError })
        .eq("id", row.id);

    const settle = async (result: SendResult) => {
      if (result.ok) {
        await markSent(result.messageId);
        sent++;
        return;
      }
      if (isCritical || row.attempts + 1 >= MAX_ATTEMPTS) {
        await markFailed(result.error ?? "unknown error");
        failed++;
      } else {
        await markRetry(result.error ?? "unknown error");
        retried++;
      }
    };

    // Scoped to exactly one template, same pattern as the PDF-attachment
    // special case below: the Trustpilot business profile doesn't exist yet
    // (a founder/ops action), so this can't render a real link. Checked
    // before calling TEMPLATE_MAP so a missing env var fails just this row
    // with a clear reason -- not an unhandled throw inside a render
    // function, which would crash this whole batch run for every other
    // pending notification too.
    if (row.template === "reputation_review_request_trustpilot" && !Deno.env.get("TRUSTPILOT_REVIEW_URL")) {
      await markFailed("TRUSTPILOT_REVIEW_URL is not configured -- Trustpilot business profile not set up yet");
      failed++;
      continue;
    }

    const payload = row.payload ?? {};
    const renderFn = row.template ? TEMPLATE_MAP[row.template] : undefined;
    let dbBody: { subject: string | null; body: string } | undefined;
    let render: TemplateRender | undefined = renderFn
      ? renderFn(payload, { notificationId: row.id, recipientId: row.recipient_id })
      : undefined;

    if (!render && row.template) {
      // DB-driven fallback (17.5) — a template that was registered in
      // notification_templates/notification_template_locales but never
      // added to TEMPLATE_MAP above.
      const { data: localeRow } = await supabase
        .from("notification_template_locales")
        .select("subject, body")
        .eq("template_key", row.template)
        .eq("locale", "en")
        .eq("channel", row.channel)
        .eq("is_active", true)
        .maybeSingle();

      if (localeRow) {
        dbBody = localeRow;
        const body = substituteTemplatePlaceholders(localeRow.body, payload);
        render = {
          smsText: body,
          email: row.channel === "email"
            ? {
                subject: substituteTemplatePlaceholders(localeRow.subject ?? row.template, payload),
                html: body,
                text: body,
              }
            : undefined,
        };
      }
    }

    if (!render) {
      await markFailed("unknown template");
      failed++;
      continue;
    }

    // S13: INV-07 guard, quiet hours, daily cap and the SMS rule, decided by one pure function.
    const privacy = privacyFor({
      role: roleById.get(row.recipient_id),
      discreetFlag: discreetById.get(row.recipient_id),
      known: !settingsDegraded,
      channel: row.channel,
      audience: audienceError || !row.template ? null : audienceByTemplate.get(row.template),
      // Only worth an Auth lookup when the template's audience is a patient one; otherwise privacy is off anyway.
      toEmailIsOwn: row.channel === "email" && !audienceError && PATIENT_AUDIENCES.has(String(audienceByTemplate.get(row.template ?? "") ?? ""))
        ? await emailIsOwn(row.recipient_id, (row.payload ?? {}).to_email)
        : null,
    });
    const decision = decide({
      channel: row.channel,
      priority: row.priority,
      nowMs: Date.now(),
      // Quiet hours are a patient's own setting; a clinician is never held back overnight.
      quiet: privacy.quietApplies
        ? (quietById.get(row.recipient_id) ?? defaultQuiet)
        : { ...defaultQuiet, enabled: false },
      routinePushSentToday: pushSentToday.get(row.recipient_id) ?? 0,
      routinePushPerDay,
      wordingViolations: wordingViolationsFor(row.template, row.channel, dbBody),
      isClinicianPage: isClinicianPageRow(roleById.get(row.recipient_id), row.template, row.priority),
      safetyCritical: isSafetyCritical(row.template),
      previouslyHeld: previouslyHeldIds.has(row.id),
    });
    if (decision.action === "block") {
      await markFailed(`blocked: INV-07 wording (${decision.violations.slice(0, 3).join(", ")})`);
      await recordEvent(row.id, "blocked_inv07", "system", null, { template: row.template, violations: decision.violations.slice(0, 5) });
      failed++;
      continue;
    }
    if (decision.action === "suppress") {
      await suppress(row.id, decision.reason === "daily_cap" ? "daily push cap reached; the in-app copy stands" : "sms is for verification codes and clinician paging only");
      await recordEvent(row.id, "suppressed_cap", "system", null, { reason: decision.reason });
      suppressed++;
      continue;
    }
    if (decision.action === "defer") {
      // Held, never dropped: the row stays pending and is picked up once quiet hours end. No attempt is used.
      const { error: holdError } = await supabase.from("notifications").update({ send_after: new Date(decision.until).toISOString() }).eq("id", row.id);
      // If the hold could not be saved the row stays pending and is decided again on the next pass: never sent early, never lost.
      if (holdError) {
        console.error("quiet-hours hold not saved; row stays pending", row.id, holdError.message);
        continue; // not counted, no event: it is decided again next pass
      }
      await recordEvent(row.id, "deferred_quiet", "system", null, { until: new Date(decision.until).toISOString() });
      deferred++;
      continue;
    }

    // Destination resolution. Rows queued for a non-profile recipient (e.g. a
    // no-login partner pharmacy) carry an explicit `to_phone`/`to_email` in the
    // payload; recipient-profile reminder rows fall back to profiles.phone.
    let toEmail = typeof payload.to_email === "string" ? payload.to_email : undefined;
    // security.* notices (new sign-in, recovery, the sign-in number) go to the account's own VERIFIED address. The older producers
    // (record_login_device, queue_recovery_notice) queue the email row without payload.to_email, so the address is looked up here,
    // from Auth by the recipient id, never from the payload; an unverified address is not used. Scoped to security.* templates.
    if (
      !toEmail && row.channel === "email" && typeof row.template === "string" && row.template.startsWith("security.")
    ) {
      const { data: authUser } = await supabase.auth.admin.getUserById(row.recipient_id);
      if (authUser?.user?.email && authUser.user.email_confirmed_at) toEmail = authUser.user.email;
    }
    const toPhone = typeof payload.to_phone === "string"
      ? payload.to_phone
      : phoneById.get(row.recipient_id) ?? undefined;

    if (row.channel === "email") {
      if (!render.email) {
        await markFailed("template has no email rendering");
        failed++;
        continue;
      }
      if (!toEmail) {
        await markFailed("recipient has no email address");
        failed++;
        continue;
      }
      // Discreet mode: a person's own email carries fixed generic words and no link (the documents name the request).
      const discreetMail = privacy.discreet;
      if (discreetMail && row.template === "reputation_review_request_trustpilot") {
        // The ask is only a review link, which a generic email cannot carry. Not sent, and the prompt is not marked sent.
        await suppress(row.id, "discreet mode: a review request is only a link, so it is not sent");
        suppressed++;
        continue;
      }
      // OQ-91: no PDF is attached any more. The two document emails carry a signed, login-protected link and no content.
      const docLink = !discreetMail && row.template != null && DISCREET_DOCUMENT_TEMPLATES.has(row.template)
        ? await documentLinkFor(row.template, row.recipient_id, payload)
        : null;
      // S13: an address that hard-bounced or reported spam is never mailed again (Resend webhook records it).
      const { data: suppressedRow } = await supabase
        .from("notification_email_suppressions")
        .select("email")
        .eq("email", toEmail.toLowerCase())
        .maybeSingle<{ email: string }>();
      if (suppressedRow) {
        await markFailed("address suppressed after a bounce or complaint");
        await recordEvent(row.id, "failed", "resend", null, { reason: "suppressed_address" });
        failed++;
        continue;
      }
      const isDocument = discreetMail && row.template != null && DISCREET_DOCUMENT_TEMPLATES.has(row.template);
      const generic = discreetMail ? discreetEmail(isCritical || isSafetyCritical(row.template), isDocument) : null;
      const emailResult = generic
        ? await sendEmail(toEmail, generic.subject, generic.html, generic.text)
        : docLink
          ? await sendEmail(toEmail, ...withDocumentLink(render.email, render.smsText, docLink))
          : await sendEmail(toEmail, render.email.subject, render.email.html, render.email.text ?? render.smsText);
      await settle(emailResult);
      if (emailResult.ok) await recordEvent(row.id, "accepted", "resend", emailResult.messageId ?? null);
      // The document is open in the app (lab request: /api/patient/lab-order/<id>/request, care plan:
      // /api/patient/preventive-care-plan). The event makes that traceable.
      if (emailResult.ok && isDocument) await recordEvent(row.id, "discreet_document_in_app", "system", null, { template: row.template });
      // Scoped to exactly one template, same pattern as the PDF-attachment
      // case above: mirrors this send onto the linked reputation_review_prompts
      // row so the admin funnel can distinguish "sent" from "still queued" --
      // without this, a Trustpilot ask that genuinely went out is
      // indistinguishable from one that never left the queue.
      if (
        emailResult.ok &&
        row.template === "reputation_review_request_trustpilot" &&
        typeof payload.reputation_review_prompt_id === "string"
      ) {
        await supabase
          .from("reputation_review_prompts")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", payload.reputation_review_prompt_id)
          .eq("status", "queued");
      }
    } else if (row.channel === "push") {
      const subs = subscriptionsByProfile.get(row.recipient_id) ?? [];
      const envelope = pushEnvelope(privacy.discreet, render.smsText, PUSH_BODY_MAX_CHARS, isCritical || isSafetyCritical(row.template));
      const pushPayload = {
        title: envelope.title,
        body: envelope.body,
        url: render.pushUrl ?? "/",
        notificationId: row.id,
      };

      // Same recipient may have a browser subscription and/or a phone with
      // the native app installed — fan out to whichever transports they
      // have, exactly the way sendWebPush already fans out across multiple
      // browser subscriptions for one user.
      const [webResult, nativeResult] = await Promise.all([
        sendWebPush(subs.filter(isWebPushSubscription), pushPayload),
        sendExpoPush(subs.filter(isNativePushSubscription), pushPayload, isCritical || isSafetyCritical(row.template)),
      ]);
      const pushOk = webResult.ok || nativeResult.ok;
      const pushResult = {
        ok: pushOk,
        error: pushOk ? undefined : (webResult.error ?? nativeResult.error),
        goneSubscriptionIds: [...webResult.goneSubscriptionIds, ...nativeResult.goneSubscriptionIds],
      };

      if (pushResult.goneSubscriptionIds.length > 0) {
        // Best-effort cleanup — never lets a push-service-side error affect
        // whether this notification itself is treated as sent/failed.
        await supabase
          .from("push_subscriptions")
          .update({ disabled_at: new Date().toISOString() })
          .in("id", pushResult.goneSubscriptionIds);
      }

      if (pushOk) {
        if (row.priority === "routine" && !isSafetyCritical(row.template)) pushSentToday.set(row.recipient_id, (pushSentToday.get(row.recipient_id) ?? 0) + 1);
        await recordEvent(row.id, "accepted", "expo", null, { web: webResult.ok, native: nativeResult.ok });
        for (const t of nativeResult.tickets ?? []) {
          await recordEvent(row.id, "receipt_pending", "expo", t.id, { subscription_id: t.subscriptionId });
        }
      }
      // S13 (INV-08): a failed routine push no longer falls back to SMS. The in-app copy stands, and the
      // attempt limit below decides when this row is given up on. Critical rows are unchanged: a failed push
      // becomes its own `failed` row that the escalation engine turns into the next channel's tracked hop.
      await settle(pushResult);
    } else if (row.channel === "voice") {
      if (!toPhone) {
        await markFailed("recipient has no phone number on file");
        failed++;
        continue;
      }
      await settle(await sendTermiiVoiceCall(toPhone, render.smsText));
    } else {
      if (!toPhone) {
        await markFailed("recipient has no phone number on file");
        failed++;
        continue;
      }
      await settle(await sendTermiiSms(toPhone, render.smsText));
    }
  }

  return Response.json({ processed: rows.length, sent, retried, failed, suppressed, deferred, pushedBack: pushedBackIds.length });
}));
