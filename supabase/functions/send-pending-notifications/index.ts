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
import { decide, pushEnvelope } from "../_shared/notifications/delivery.ts";
import type { QuietSettings } from "../_shared/notifications/delivery.ts";

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
  async_consult_answered: "appointments",
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
): Promise<SendResult & { goneSubscriptionIds: string[]; tickets?: Array<{ id: string; subscriptionId: string }> }> {
  if (subscriptions.length === 0) {
    return { ok: false, error: "no active push subscription", goneSubscriptionIds: [] };
  }

  const messages = subscriptions.map((sub) => ({
    to: sub.expo_push_token,
    title: payload.title,
    body: payload.body,
    data: { url: payload.url, notificationId: payload.notificationId },
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
 * Fetches the take-anywhere test request PDF for one lab order from the
 * Next.js app, so it can ride along as an email attachment.
 *
 * Deliberately fails soft: any problem here (secret unset, app unreachable,
 * order deleted between enqueue and send, a non-200) returns null rather than
 * throwing, and the caller sends the email WITHOUT the attachment rather than
 * not sending it at all. The confirmation email is the guaranteed thing the
 * founder requirement asks for; the PDF is a genuine enhancement to it, not a
 * precondition — a patient who does not get the attachment can still open the
 * request in the app, exactly as before this existed. Logged either way, so a
 * silent failure here is at least visible in the function's own logs.
 */
async function fetchLabOrderRequestPdf(orderId: string): Promise<EmailAttachment | null> {
  const serviceKey = Deno.env.get("NOTIFICATIONS_SERVICE_KEY");
  if (!serviceKey) {
    console.error("lab-order PDF attachment: NOTIFICATIONS_SERVICE_KEY not configured");
    return null;
  }
  const base = Deno.env.get("APP_BASE_URL") ?? "https://app.tarragonhealth.ng";

  try {
    const response = await fetch(
      `${base}/api/internal/notifications/lab-order-request-pdf/${orderId}`,
      { headers: { "X-Service-Key": serviceKey } },
    );
    if (!response.ok) {
      console.error(`lab-order PDF attachment: fetch returned ${response.status} for order ${orderId}`);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Deno has no Buffer global; btoa needs a binary string, built in chunks
    // so a large PDF does not blow the call-stack a spread/apply would hit.
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { filename: `tarragon-test-request-${orderId}.pdf`, content: btoa(binary) };
  } catch (error) {
    console.error("lab-order PDF attachment: fetch threw", error);
    return null;
  }
}

/**
 * Fetches the preventive & chronic care plan PDF for one patient, so the
 * "preventive_care_plan_updated" email can carry it as an attachment. Same
 * fail-soft shape as fetchLabOrderRequestPdf and for the same reason: the
 * email itself is the guaranteed thing (queued by
 * private.queue_preventive_care_plan_email_reminders), the PDF is an
 * enhancement to it — a patient who does not get the attachment can still
 * open their plan in the app.
 */
async function fetchPreventiveCarePlanPdf(patientId: string): Promise<EmailAttachment | null> {
  const serviceKey = Deno.env.get("NOTIFICATIONS_SERVICE_KEY");
  if (!serviceKey) {
    console.error("preventive care plan PDF attachment: NOTIFICATIONS_SERVICE_KEY not configured");
    return null;
  }
  const base = Deno.env.get("APP_BASE_URL") ?? "https://app.tarragonhealth.ng";

  try {
    const response = await fetch(
      `${base}/api/internal/notifications/preventive-care-plan-pdf/${patientId}`,
      { headers: { "X-Service-Key": serviceKey } },
    );
    if (!response.ok) {
      console.error(
        `preventive care plan PDF attachment: fetch returned ${response.status} for patient ${patientId}`,
      );
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { filename: `tarragon-preventive-care-plan.pdf`, content: btoa(binary) };
  } catch (error) {
    console.error("preventive care plan PDF attachment: fetch threw", error);
    return null;
  }
}

Deno.serve(async () => {
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
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, phone, role, discreet_mode")
    .in("id", recipientIds)
    .returns<Array<{ id: string; phone: string | null; role: string | null; discreet_mode: boolean | null }>>();
  const phoneById = new Map((profiles ?? []).map((p) => [p.id, p.phone]));
  const roleById = new Map((profiles ?? []).map((p) => [p.id, p.role]));
  const discreetById = new Map((profiles ?? []).map((p) => [p.id, p.discreet_mode === true]));

  // S13: PROPOSED rules (versioned in notification_rules_config) and each recipient's own quiet hours.
  const { data: rulesRow } = await supabase
    .from("notification_rules_config")
    .select("config")
    .eq("is_active", true)
    .maybeSingle<{ config: { quietHours?: { enabled?: boolean; start?: string; end?: string }; routinePushPerDay?: number } }>();
  const defaultQuiet: QuietSettings = {
    enabled: rulesRow?.config.quietHours?.enabled ?? true,
    start: rulesRow?.config.quietHours?.start ?? "21:00",
    end: rulesRow?.config.quietHours?.end ?? "07:00",
  };
  const routinePushPerDay = rulesRow?.config.routinePushPerDay ?? 4;
  const { data: settingRows } = await supabase
    .from("notification_settings")
    .select("profile_id, quiet_enabled, quiet_start, quiet_end")
    .in("profile_id", recipientIds)
    .returns<Array<{ profile_id: string; quiet_enabled: boolean; quiet_start: string; quiet_end: string }>>();
  const quietById = new Map<string, QuietSettings>(
    (settingRows ?? []).map((r) => [r.profile_id, { enabled: r.quiet_enabled, start: r.quiet_start.slice(0, 5), end: r.quiet_end.slice(0, 5) }]),
  );
  const { data: pushToday } = await supabase
    .from("notifications")
    .select("recipient_id")
    .eq("channel", "push")
    .eq("priority", "routine")
    .eq("status", "sent")
    .gte("sent_at", new Date(Date.now() - 24 * 3_600_000).toISOString())
    .in("recipient_id", recipientIds)
    .returns<Array<{ recipient_id: string }>>();
  const pushSentToday = new Map<string, number>();
  for (const r of pushToday ?? []) pushSentToday.set(r.recipient_id, (pushSentToday.get(r.recipient_id) ?? 0) + 1);

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
    if (row.priority === "critical") return true; // never gated — see TEMPLATE_CATEGORY's header comment
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
    if (row.priority !== "routine") continue;
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

  for (const row of rows) {
    if (foldedIds.has(row.id)) continue;

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
    const decision = decide({
      channel: row.channel,
      priority: row.priority,
      nowMs: Date.now(),
      // Quiet hours are a patient's own setting. A clinician, and a partner reached at an explicit address
      // (payload.to_email), are never held back overnight.
      quiet: roleById.get(row.recipient_id) === "patient" && typeof (row.payload ?? {}).to_email !== "string"
        ? (quietById.get(row.recipient_id) ?? defaultQuiet)
        : { ...defaultQuiet, enabled: false },
      routinePushSentToday: pushSentToday.get(row.recipient_id) ?? 0,
      routinePushPerDay,
      wordingViolations: wordingViolationsFor(row.template, row.channel, dbBody),
      isClinicianPage: row.priority === "critical" || roleById.get(row.recipient_id) === "clinician",
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
      await supabase.from("notifications").update({ send_after: new Date(decision.until).toISOString() }).eq("id", row.id);
      await recordEvent(row.id, "deferred_quiet", "system", null, { until: new Date(decision.until).toISOString() });
      deferred++;
      continue;
    }

    // Destination resolution. Rows queued for a non-profile recipient (e.g. a
    // no-login partner pharmacy) carry an explicit `to_phone`/`to_email` in the
    // payload; recipient-profile reminder rows fall back to profiles.phone.
    const toEmail = typeof payload.to_email === "string" ? payload.to_email : undefined;
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
      // Scoped to exactly one template, deliberately: this is the founder
      // requirement that the test-request email carry the PDF, not a general
      // "attach a PDF" mechanism every template gets for free. A future
      // template that wants the same treatment should add its own explicit
      // case here rather than have this condition grown into something
      // fuzzier.
      let attachments: EmailAttachment[] | undefined;
      if (row.template === "lab_order_requested_patient" && typeof payload.order_id === "string") {
        const pdf = await fetchLabOrderRequestPdf(payload.order_id);
        if (pdf) attachments = [pdf];
      } else if (row.template === "preventive_care_plan_updated") {
        const pdf = await fetchPreventiveCarePlanPdf(row.recipient_id);
        if (pdf) attachments = [pdf];
      }
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
      const emailResult = await sendEmail(
        toEmail, render.email.subject, render.email.html, render.email.text ?? render.smsText, attachments,
      );
      await settle(emailResult);
      if (emailResult.ok) await recordEvent(row.id, "accepted", "resend", emailResult.messageId ?? null);
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
      const envelope = pushEnvelope(discreetById.get(row.recipient_id) === true, render.smsText, PUSH_BODY_MAX_CHARS);
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
        sendExpoPush(subs.filter(isNativePushSubscription), pushPayload),
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
        if (row.priority === "routine") pushSentToday.set(row.recipient_id, (pushSentToday.get(row.recipient_id) ?? 0) + 1);
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

  return Response.json({ processed: rows.length, sent, retried, failed, suppressed, deferred });
});
