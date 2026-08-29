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
// Channel priority (2026-07-30): push is the default first channel
// platform-wide — private.remap_notification_channel() rewrites a queued
// 'whatsapp' row to 'push' at insert time whenever the recipient has an
// active push_subscriptions row. WhatsApp/SMS are fallback only, never the
// default, for both routine and critical rows. The difference between the
// two priorities is what happens when push fails to SEND (not "goes
// unopened" — that's the escalation engine's job, not this function's):
// routine rows fall back inline to whatsapp -> sms within this same pass
// (simple best-effort delivery, no confirmation tracking needed); critical
// rows do NOT — a critical row's failed send is picked up by
// private.escalate_unconfirmed_critical_notifications() and turned into a
// new, separately-tracked notification on the next ladder channel, so every
// hop stays its own auditable, delivery-tracked row.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const EXTERNAL_TIMEOUT_MS = 5_000;
// Push notification bodies are shown in a compact OS tray — trim the
// (often multi-sentence) smsText down to something that reads cleanly there.
const PUSH_BODY_MAX_CHARS = 160;

// Patient-experience review 2026-07-31: several reminder templates only ever
// said "open the app" with no actual link — real friction for a patient
// trying to act on a WhatsApp/SMS/push nudge. This builds a real deep link
// into smsText (shared by SMS, push, and voice — see the dispatch loop
// below), never into the WhatsApp structured template's body params (those
// are pre-approved fixed slots; a URL there needs its own Meta template
// approval, out of scope here). Deliberately its own APP_BASE_URL, distinct
// from the marketing site's NEXT_PUBLIC_SITE_URL (root domain) — these
// links point at the platform's `app.` subdomain. Set on BOTH .env.local
// (local dev) and this function's own Supabase Edge Function secrets store
// — they do not share a source, per the Stripe-webhook lesson elsewhere in
// this codebase. Falls back to the production app domain so a missing
// secret still produces a working link rather than a broken one.
function appUrl(path: string): string {
  const base = Deno.env.get("APP_BASE_URL") ?? "https://app.tarragonhealth.ng";
  return `${base}${path}`;
}

interface NotificationRow {
  id: string;
  recipient_id: string;
  channel: "whatsapp" | "sms" | "in_app" | "email" | "push" | "voice";
  template: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  priority: "routine" | "critical";
}

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

interface TemplateRender {
  metaTemplateName: string;
  languageCode: string;
  components: Array<{
    type: "body";
    parameters: Array<{ type: "text"; text: string }>;
  }>;
  smsText: string;
  // Present only for templates that fan out to the `email` channel. Absent
  // for the legacy reminder templates, which are WhatsApp/SMS only — an email
  // row referencing a template without this is failed with a clear reason.
  email?: { subject: string; html: string; text: string };
  // Present only where a template author has bothered to compute a specific
  // in-app destination (see the push-channel dispatch below, which otherwise
  // falls back to the bare "/" every push notification used before
  // 2026-07-31 — tapping a reminder just opened the homepage regardless of
  // what it was about). Deliberately opt-in per template rather than a
  // blanket default, so untouched templates keep their exact prior behavior.
  pushUrl?: string;
}

// Meta-approved WhatsApp template names must match these keys exactly once
// submitted for approval (docs/ARCHITECTURE.md §8: ~2 week lead time).
// Unknown template keys are never guessed at — see the caller below.
const TEMPLATE_MAP: Record<
  string,
  (payload: Record<string, unknown>) => TemplateRender
> = {
  vitals_reminder: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    // suggested_vital_type is a best-effort hint from queue_vitals_reminders
    // (set when the patient's active care_plans condition maps cleanly to
    // one vital type) — absent for most patients, who get the generic
    // vitals section link instead of a fictitious specific type.
    const suggestedType =
      typeof payload.suggested_vital_type === "string" ? payload.suggested_vital_type : null;
    const path = suggestedType ? `/patient/quick-log/${suggestedType}` : "/patient/vitals";
    return {
      metaTemplateName: "vitals_reminder",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: dueDate }] },
      ],
      smsText:
        `Hi, it's time to log your vitals (due ${dueDate}). ` +
        `Tap to log it: ${appUrl(path)} Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent by the daily lifestyle-coaching cron (coaching-run.ts via
  // messaging-gateway.ts) when a patient's engagement signals call for a
  // supportive nudge. `message` is LLM-personalised copy when available
  // (coaching-proposer.ts) — already screened by toneGuard before this row
  // was ever queued — falling back to a generic check-in line when absent
  // (rules-only decision, or the LLM call failed). Falls back to SMS until
  // the Meta template is approved, same as the other not-yet-approved
  // templates in this file.
  lifestyle_nudge: (payload) => {
    const message = String(
      payload.message ??
        "Checking in on your lifestyle programme; log a quick update when you get a chance.",
    );
    const path = "/patient/lifestyle";
    return {
      metaTemplateName: "lifestyle_nudge",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: message }] }],
      smsText: `${message} Tarragon Health`,
      pushUrl: path,
    };
  },
  medication_refill_reminder: (payload) => {
    const drugName = String(payload.drug_name ?? "your medication");
    const refillDate = String(payload.refill_date ?? "soon");
    const path = "/patient/medications";
    return {
      metaTemplateName: "medication_refill_reminder",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: drugName },
            { type: "text", text: refillDate },
          ],
        },
      ],
      smsText:
        `Hi, your ${drugName} refill is due ${refillDate}. ` +
        `Sort it here: ${appUrl(path)} Tarragon Health`,
      pushUrl: path,
    };
  },
  booking_reminder: (payload) => {
    const facilityName = String(payload.facility_name ?? "your facility");
    const serviceType = String(payload.service_type ?? "your appointment");
    const requestedDate = String(payload.requested_date ?? "soon");
    const daysBefore = String(payload.days_before ?? "");
    return {
      metaTemplateName: "booking_reminder",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: serviceType },
            { type: "text", text: facilityName },
            { type: "text", text: requestedDate },
          ],
        },
      ],
      smsText:
        `Hi, reminder: your ${serviceType} request at ${facilityName} is for ${requestedDate} ` +
        `(${daysBefore} day${daysBefore === "1" ? "" : "s"} from now). ` +
        `Reply on WhatsApp or open the app. Tarragon Health`,
    };
  },
  // Sent to the patient as a scheduled adherence check-in comes due (see
  // private.queue_medication_checkin_reminders). Reminds them to answer the
  // check-in in the app — the response is never captured over WhatsApp/SMS.
  medication_adherence_checkin: (payload) => {
    const drugName = String(payload.drug_name ?? "your medication");
    const type = String(payload.checkin_type ?? "");
    const prompt =
      type === "started"
        ? `Have you started ${drugName}?`
        : type === "side_effects"
          ? `Any side effects from ${drugName}?`
          : type === "missed_doses"
            ? `How many doses of ${drugName} have you missed?`
            : `Time for a quick review of ${drugName}.`;
    const path = "/patient/medications";
    return {
      metaTemplateName: "medication_adherence_checkin",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: drugName },
            { type: "text", text: prompt },
          ],
        },
      ],
      smsText: `${prompt} Answer here: ${appUrl(path)} Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent to the patient as a scheduled medication review comes due (see
  // private.queue_medication_review_reminders). Reminder only — the review is
  // completed by a doctor in the clinician worklist, never over WhatsApp.
  medication_review_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      metaTemplateName: "medication_review_due",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: dueDate }] },
      ],
      smsText:
        `Hi, your medication review is due ${dueDate}. Your care team will be in touch; ` +
        `open the app to see details. Tarragon Health`,
    };
  },
  // Sent to the patient as a scheduled vaccination comes due (see
  // private.queue_vaccination_reminders). Reminder only — logging/booking a
  // dose always happens in-app, never over WhatsApp.
  vaccination_due: (payload) => {
    const vaccineName = String(payload.vaccine_name ?? "a vaccination");
    const dueDate = String(payload.due_date ?? "soon");
    return {
      metaTemplateName: "vaccination_due",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: vaccineName },
            { type: "text", text: dueDate },
          ],
        },
      ],
      smsText:
        `Hi, your ${vaccineName} is due ${dueDate}. Open the Tarragon Health app to book or ` +
        `log it. Tarragon Health`,
    };
  },
  // Sent to the patient as a scheduled screening comes due (see
  // private.queue_screening_reminders). Reminder only — booking/logging a
  // screening always happens in-app, never over WhatsApp/SMS.
  screening_due: (payload) => {
    const screenTypeName = String(payload.screen_type_name ?? "a screening");
    const dueDate = String(payload.due_date ?? "soon");
    const path = "/patient/prevention";
    return {
      metaTemplateName: "screening_due",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: screenTypeName },
            { type: "text", text: dueDate },
          ],
        },
      ],
      smsText:
        `Hi, your ${screenTypeName} is due ${dueDate}. Open the Tarragon Health app to book it. ` +
        `Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent ~1 month before a patient's next annual Health Check (Core/Advanced/
  // Comprehensive Screen) is due — see
  // private.queue_health_check_due_reminders. Reminder only — ordering the
  // check and uploading the result always happen in-app, never over
  // WhatsApp/SMS.
  health_check_due_soon: (payload) => {
    const bundleName = String(payload.bundle_name ?? "your annual Health Check");
    const dueDate = String(payload.due_date ?? "soon");
    const path = "/patient/prevention#health-check";
    return {
      metaTemplateName: "health_check_due_soon",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: bundleName },
            { type: "text", text: dueDate },
          ],
        },
      ],
      smsText:
        `Hi, your ${bundleName} is due ${dueDate}, about a month from now. Open the Tarragon ` +
        `Health app to book it in good time. Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent to a patient on an active diabetes care plan when a retinal or
  // renal (kidney) complication check is overdue, or has never been done
  // (see private.queue_diabetes_complication_reminders). Reminder only —
  // the check itself is recorded by a clinician in-app, never over
  // WhatsApp/SMS.
  diabetes_complication_check_due: (payload) => {
    const checkType = String(payload.check_type ?? "");
    const label = checkType === "retinal" ? "eye screening" : checkType === "renal" ? "kidney check" : "a complication check";
    const dueDate = String(payload.due_date ?? "soon");
    const path = "/patient/vitals";
    return {
      metaTemplateName: "diabetes_complication_check_due",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: label },
            { type: "text", text: dueDate },
          ],
        },
      ],
      smsText:
        `Hi, your diabetes ${label} is due ${dueDate}. Your care team can do this at your next visit — ` +
        `open the app for details. — Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent on a genuine risk-level transition surfaced by a patient_risk_scores
  // computation — currently BP-control (see assessBpControlBestEffort) and
  // the CV-risk worsening-lipid-trend escalation (see flagCvRiskEscalations).
  // Deliberately one shared, generic-voiced template for every such trigger
  // (matches RiskSignalsCard's own plain-language, non-alarmist copy) rather
  // than a bespoke Meta template per signal — keeps the still-pending Meta
  // template-approval backlog from growing with every new risk signal added.
  // Never carries a raw clinical number; the app is where the detail lives.
  risk_signal_attention: (payload) => {
    const label = String(payload.signal_label ?? "Something in your recent readings");
    const reason = String(payload.reason ?? "has needed some extra attention");
    const path = "/patient";
    return {
      metaTemplateName: "risk_signal_attention",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: label },
            { type: "text", text: reason },
          ],
        },
      ],
      smsText:
        `Hi, ${label} ${reason}. Your care team is aware; open the Tarragon Health app to see ` +
        `more. Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent to the patient when their care team replies in an in-app message
  // thread. Notification only — the message itself is read in the app, never
  // over WhatsApp/SMS.
  new_care_message: () => {
    return {
      metaTemplateName: "new_care_message",
      languageCode: "en",
      components: [{ type: "body", parameters: [] }],
      smsText:
        "You have a new message from your care team. Open the Tarragon Health app to read and " +
        "reply. Tarragon Health",
    };
  },
  // Sent to the patient as a scheduled periodic health review comes due (see
  // private.queue_preventive_review_reminders). Reminder only — the review is
  // completed by a doctor in the clinician worklist, never over WhatsApp.
  preventive_review_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      metaTemplateName: "preventive_review_due",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: dueDate }] },
      ],
      smsText:
        `Hi, your preventive health review is due ${dueDate}. Your care team will be in touch; ` +
        `open the app to see details. Tarragon Health`,
    };
  },
  // Sent to an entitled patient when their yearly Annual Health Review cycle
  // opens (see private.queue_annual_reviews). Reminder only — the review runs
  // through the in-app clinician worklist, never over WhatsApp.
  annual_review_due: (payload) => {
    const cycleYear = String(payload.cycle_year ?? "this year");
    return {
      metaTemplateName: "annual_review_due",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: cycleYear }] },
      ],
      smsText:
        `Hi, your ${cycleYear} Annual Health Review has started. Your care team will guide ` +
        `you through it; open the app to see what's next. Tarragon Health`,
    };
  },
  // Sent to the patient after they confirm a video-consult slot for their
  // Annual Health Review (patient annual-review-actions). Confirmation only —
  // the consult link lives in the app.
  annual_review_consult_scheduled: (payload) => {
    const raw = String(payload.scheduled_at ?? "");
    const when = (() => {
      const d = new Date(raw);
      return Number.isNaN(d.getTime())
        ? "the agreed time"
        : d.toLocaleString("en-NG", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Africa/Lagos",
          });
    })();
    return {
      metaTemplateName: "annual_review_consult_scheduled",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: when }] },
      ],
      smsText:
        `Your Annual Health Review video consult is confirmed for ${when}. ` +
        `The join link is in the Tarragon Health app. Tarragon Health`,
    };
  },
  // Sent to the patient as a lifestyle programme review comes due (see
  // private.queue_lpe_review_reminders). Reminder only — the review is
  // completed by their care team in-app, never over WhatsApp.
  lifestyle_review_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      metaTemplateName: "lifestyle_review_due",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: dueDate }] },
      ],
      smsText:
        `Hi, your lifestyle programme review is due ${dueDate}. Your care team will be in ` +
        `touch; open the app to see details. Tarragon Health`,
    };
  },
  // Sent once, ~24h before an active wellness challenge's deadline, only if
  // the patient hasn't hit the target yet (see private.queue_wellness_
  // challenge_ending_nudges) — private.evaluate_wellness_challenges silently
  // expires it with no warning otherwise. Reminder only; logging progress and
  // claiming the reward always happen in-app.
  wellness_challenge_ending: (payload) => {
    const title = String(payload.challenge_title ?? "your challenge");
    const progress = String(payload.progress ?? "0");
    const target = String(payload.target ?? "0");
    const path = "/patient/wellness";
    return {
      metaTemplateName: "wellness_challenge_ending",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: title },
            { type: "text", text: `${progress}/${target}` },
          ],
        },
      ],
      smsText:
        `Hi, your "${title}" challenge ends in 24 hours and you're at ${progress}/${target}. ` +
        `Finish it in the Tarragon Health app. Tarragon Health`,
      pushUrl: path,
    };
  },
  // Proactive-outreach nudge (see private.queue_care_outreach). One aggregated,
  // warm check-in per patient when the nightly engine surfaces them from risk
  // scores/care gaps. Reminder only — everything happens in the app; the
  // coordinator worklist is the acting side of this loop.
  care_outreach_checkin: () => {
    return {
      metaTemplateName: "care_outreach_checkin",
      languageCode: "en",
      components: [{ type: "body", parameters: [] }],
      smsText:
        "Hi, your recent health record suggests a quick check-in would help. Open the " +
        "Tarragon Health app to see what's due; booking takes a minute. Tarragon Health",
    };
  },
  // Sent when a doctor answers the patient's ask-a-doctor consult (see
  // answerAsyncConsult). Notification only — the answer itself lives in-app.
  async_consult_answered: () => {
    return {
      metaTemplateName: "async_consult_answered",
      languageCode: "en",
      components: [{ type: "body", parameters: [] }],
      smsText:
        "A doctor has answered your question. Open the Tarragon Health app to read it. " +
        "Tarragon Health",
    };
  },
  // Sent after a patient self-books a video check-in slot (bookVideoVisit).
  // Confirmation only — the join link lives in the app.
  video_consult_booked: (payload) => {
    const raw = String(payload.scheduled_at ?? "");
    const when = (() => {
      const d = new Date(raw);
      return Number.isNaN(d.getTime())
        ? "the agreed time"
        : d.toLocaleString("en-NG", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Africa/Lagos",
          });
    })();
    return {
      metaTemplateName: "video_consult_booked",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: when }] },
      ],
      smsText:
        `Your video check-in with your Tarragon doctor is booked for ${when}. ` +
        `The join link is in the app. Tarragon Health`,
    };
  },
  // Sent when a doctor offers alternate times instead of the patient's
  // original request (propose_video_visit_alternate_slots) — the patient
  // picks one in the app within 24h or the payment is refunded. Confirmation
  // only; the actual times to choose from live in the app, not this message.
  video_visit_alternate_proposed: () => {
    return {
      metaTemplateName: "video_visit_alternate_proposed",
      languageCode: "en",
      components: [{ type: "body", parameters: [] }],
      smsText:
        "Your doctor offered different times for your video visit. Pick one in the app within 24 hours, or you'll be refunded in full. Tarragon Health",
    };
  },
  // Sent when a doctor declines a paid video-visit request, or nobody
  // confirmed a time within 24h (decline action / video-visit-refunds cron).
  // The refund is automatic; this just tells the patient honestly what happened.
  video_visit_declined: (payload) => {
    const reason = String(payload.reason ?? "").trim();
    return {
      metaTemplateName: "video_visit_declined",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: reason || "No doctor was available for that time." }] },
      ],
      smsText:
        `We couldn't schedule your video visit${reason ? ` (${reason})` : ""}. ` +
        `Your payment will be refunded in full. You can request another time in the app. Tarragon Health`,
    };
  },
  // Admin broadcast / announcement (see public.admin_send_broadcast). Free-text
  // subject + body chosen by an admin, fanned out to a resolved audience. Email
  // renders the body as-is; WhatsApp needs a Meta-approved broadcast_announcement
  // template, falling back to SMS meanwhile.
  broadcast_announcement: (payload) => {
    const subject = String(payload.subject ?? "A message from Tarragon Health");
    const body = String(payload.body ?? "");
    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");
    return {
      metaTemplateName: "broadcast_announcement",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: subject },
            { type: "text", text: body },
          ],
        },
      ],
      smsText: `${subject}: ${body} Tarragon Health`,
      email: {
        subject,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<h2 style="color:#0E7C52;margin:0 0 12px">${escapeHtml(subject)}</h2>` +
          `<p>${bodyHtml}</p>` +
          `<p style="color:#0E7C52;margin-top:20px"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: `${subject}\n\n${body}\n\nTarragon Health`,
      },
    };
  },
  // Sent to the patient on the payment_confirmed transition (see
  // enqueue_pharmacy_order_notifications). WhatsApp is attempted first; the
  // pharmacy_order_patient_confirmation Meta template must be approved for the
  // WhatsApp path to land, otherwise the dispatcher falls back to smsText.
  pharmacy_order_patient_confirmation: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const pharmacyName = String(payload.pharmacy_name ?? "the pharmacy");
    const patientName = String(payload.patient_name ?? "there");
    const patientNumber = String(payload.patient_number ?? "");
    const itemsSummary = String(payload.items_summary ?? "your medication");
    const smsText =
      `Hi ${patientName}, your Tarragon Health order ${orderNumber} (${itemsSummary}) is confirmed. ` +
      `Show order ${orderNumber} and your patient ID ${patientNumber} at ${pharmacyName} to collect. ` +
      `Tarragon Health`;
    return {
      metaTemplateName: "pharmacy_order_patient_confirmation",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: orderNumber },
            { type: "text", text: itemsSummary },
            { type: "text", text: pharmacyName },
            { type: "text", text: patientNumber },
          ],
        },
      ],
      smsText,
      email: {
        subject: `Your Tarragon Health order ${orderNumber} is confirmed`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${patientName},</p>` +
          `<p>Your order is confirmed and ready to be prepared. Show the details below at ` +
          `<strong>${pharmacyName}</strong> to collect your medication.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Order number</td><td style="padding:4px 0"><strong>${orderNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient ID</td><td style="padding:4px 0"><strong>${patientNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Medication</td><td style="padding:4px 0">${itemsSummary}</td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Pharmacy</td><td style="padding:4px 0">${pharmacyName}</td></tr>` +
          `</table>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the partner pharmacy (SMS + email) on the same transition. No
  // WhatsApp channel is enqueued for this template — metaTemplateName is present
  // only to satisfy the shared TemplateRender shape and is never used.
  pharmacy_order_pharmacy_alert: (payload) => {
    const orderNumber = String(payload.order_number ?? "");
    const pharmacyName = String(payload.pharmacy_name ?? "");
    const patientName = String(payload.patient_name ?? "a patient");
    const patientNumber = String(payload.patient_number ?? "");
    const itemsSummary = String(payload.items_summary ?? "");
    const smsText =
      `New Tarragon Health order ${orderNumber}: ${patientName} (patient ID ${patientNumber}): ` +
      `${itemsSummary}. Please prepare for collection. Tarragon Health`;
    return {
      metaTemplateName: "pharmacy_order_pharmacy_alert",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: orderNumber }] },
      ],
      smsText,
      email: {
        subject: `New Tarragon Health order ${orderNumber}: ${patientName}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hello ${pharmacyName},</p>` +
          `<p>A patient has a confirmed, paid order to collect from you. Please prepare the following:</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Order number</td><td style="padding:4px 0"><strong>${orderNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient</td><td style="padding:4px 0">${patientName}</td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient ID</td><td style="padding:4px 0"><strong>${patientNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Medication</td><td style="padding:4px 0">${itemsSummary}</td></tr>` +
          `</table>` +
          `<p>The patient will present order ${orderNumber} and their patient ID at collection.</p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health: Care that stays with you.</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to whoever funded someone else's Health Wallet, when that money
  // actually becomes care (private.notify_sponsors_of_wallet_spend). Queued on
  // in_app and email only: a sponsor abroad often has no Nigerian number, and
  // email needs no template approval to reach them. Names the service category
  // and the amount and nothing else — funding care does not entitle anyone to
  // read it, so there is deliberately no result, test name or clinician here.
  // The three below are the "somebody will tell me" half of supporting
  // someone's care from a distance. Each is deliberately status-only, which is
  // what makes them honestly non_clinical and safe on an open rail: a
  // supporter is told THAT a doctor looked, never what was found.
  sponsor_care_reviewed: (payload) => {
    const person = String(payload.person_name ?? "someone you support");
    const smsText =
      `Tarragon Health: a doctor has reviewed something for ${person}. ` +
      `They will discuss what was found with ${person} directly.`;
    return {
      metaTemplateName: "sponsor_care_reviewed",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: person }] }],
      smsText,
      pushUrl: "/patient/supporting",
      email: {
        subject: `A doctor has reviewed something for ${person}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>A doctor on ${person}&rsquo;s care team has reviewed something flagged on their record.</p>` +
          `<p style="color:#5b6b78;font-size:13px">We tell you that a review happened, not what was found. That conversation belongs to ${person} and their doctor first. If you want to ask about it, you can do that in the shared thread under People you support.</p>` +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
      },
    };
  },
  sponsor_person_quiet: (payload) => {
    const person = String(payload.person_name ?? "someone you support");
    const days = String(payload.quiet_days ?? "several");
    const smsText =
      `Tarragon Health: ${person} has not logged a reading in ${days} days. A call from you often does more than a reminder from us.`;
    return {
      metaTemplateName: "sponsor_person_quiet",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: person }, { type: "text", text: days }] },
      ],
      smsText,
      pushUrl: "/patient/supporting",
      email: {
        subject: `${person} has been quiet for ${days} days`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>${person} is on a care plan that works best with regular readings, and has not logged one in ${days} days.</p>` +
          `<p>Nothing is wrong as far as we know. People simply drift, and a call from family tends to do more than another reminder from us.</p>` +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
      },
    };
  },
  sponsored_plan_started: (payload) => {
    const isPayer = payload.is_payer === true;
    const plan = String(payload.plan_name ?? "a plan");
    const person = String(payload.person_name ?? "someone");
    const sponsor = String(payload.sponsor_name ?? "someone");
    const smsText = isPayer
      ? `Tarragon Health: you are now paying for ${person}'s ${plan}. They keep their own account and can cancel any time.`
      : `Tarragon Health: ${sponsor} is now paying for your ${plan}. Your account and your records stay yours, and you can cancel any time.`;
    return {
      metaTemplateName: "sponsored_plan_started",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: isPayer ? person : sponsor }, { type: "text", text: plan }],
        },
      ],
      smsText,
      pushUrl: isPayer ? "/patient/supporting" : "/patient/subscription",
      email: {
        subject: isPayer ? `You are now paying for ${person}'s ${plan}` : `${sponsor} is paying for your ${plan}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          (isPayer
            ? `<p>${person} is now on <strong>${plan}</strong>, billed to your card.</p>` +
              `<p style="color:#5b6b78;font-size:13px">They keep their own account, their own records and their own control. You are paying for it; you are not holding it. Either of you can stop it at any time.</p>`
            : `<p><strong>${sponsor}</strong> has put you on <strong>${plan}</strong> and is paying for it.</p>` +
              `<p style="color:#5b6b78;font-size:13px">Nothing about your account changes. Your readings, results and notes stay between you and your care team, and you can cancel this at any time from your subscription page.</p>`) +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
      },
    };
  },
  sponsor_spend_receipt: (payload) => {
    const beneficiary = String(payload.beneficiary_name ?? "someone you support");
    const what = String(payload.what ?? "care");
    const amount = (Number(payload.amount_kobo ?? 0) / 100).toLocaleString("en-NG");
    const balance = (Number(payload.balance_kobo ?? 0) / 100).toLocaleString("en-NG");
    const spentOn = String(payload.spent_on ?? "");
    const smsText =
      `Tarragon Health: ₦${amount} you funded paid for ${what} for ${beneficiary}` +
      `${spentOn ? ` on ${spentOn}` : ""}. Remaining balance ₦${balance}.`;
    return {
      metaTemplateName: "sponsor_spend_receipt",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: amount },
            { type: "text", text: what },
            { type: "text", text: beneficiary },
            { type: "text", text: balance },
          ],
        },
      ],
      smsText,
      email: {
        subject: `Your ₦${amount} paid for ${what} for ${beneficiary}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Care you paid for ${beneficiary} has been used.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Paid for</td><td style="padding:4px 0"><strong>${what}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Amount</td><td style="padding:4px 0"><strong>&#8358;${amount}</strong></td></tr>` +
          (spentOn
            ? `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Date</td><td style="padding:4px 0">${spentOn}</td></tr>`
            : "") +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Balance left</td><td style="padding:4px 0">&#8358;${balance}</td></tr>` +
          `</table>` +
          `<p style="color:#5b6b78;font-size:13px">You can see everything you have funded, and what it paid for, under People you support in your dashboard. Their readings, results and notes stay between them and their care team.</p>` +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
      },
    };
  },
  // The standing monthly summary to whoever is paying for someone else's care
  // (private.queue_sponsor_monthly_reports). Generated, never assembled by a
  // person: it costs nothing per sponsor and arrives whether or not anyone
  // remembered. Money, outstanding bills and whether someone has gone quiet.
  // No clinical content, for the same reason as the spend receipt above:
  // "nothing logged in 20 days" is a statement about activity, not health.
  sponsor_monthly_report: (payload) => {
    const people = Array.isArray(payload.people)
      ? (payload.people as Record<string, unknown>[])
      : [];
    const money = (kobo: unknown) => (Number(kobo ?? 0) / 100).toLocaleString("en-NG");
    const totalSpent = people.reduce((sum, p) => sum + Number(p?.spent_kobo ?? 0), 0);
    const headline = `₦${money(totalSpent)} became care last month`;

    const rows = people
      .map((person) => {
        const name = String(person?.name ?? "someone you support");
        const bills = Number(person?.awaiting_payment ?? 0);
        const quiet = person?.quiet_days === null ? null : Number(person?.quiet_days ?? 0);
        const notes: string[] = [];
        if (bills > 0) {
          notes.push(`${bills} ${bills === 1 ? "bill is" : "bills are"} waiting to be paid for`);
        }
        if (quiet !== null && quiet >= 21) notes.push(`nothing logged in ${quiet} days`);
        return (
          `<tr><td style="padding:6px 12px 6px 0"><strong>${name}</strong></td>` +
          `<td style="padding:6px 12px 6px 0">&#8358;${money(person?.spent_kobo)} spent</td>` +
          `<td style="padding:6px 12px 6px 0">&#8358;${money(person?.balance_kobo)} left</td>` +
          `<td style="padding:6px 0;color:#5b6b78">${notes.join("; ") || "nothing outstanding"}</td></tr>`
        );
      })
      .join("");

    return {
      metaTemplateName: "sponsor_monthly_report",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: headline }] }],
      smsText: `Tarragon Health: ${headline}. See People you support in your dashboard.`,
      email: {
        subject: `Your monthly summary: ${headline}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Here is what happened last month with the care you are paying for.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">${rows}</table>` +
          `<p style="color:#5b6b78;font-size:13px">Anything marked as waiting to be paid for can be settled from their Health Wallet under People you support.</p>` +
          `<p style="color:#5b6b78;font-size:13px">This summary covers money and activity only. Their readings, results and notes stay between them and their care team.</p>` +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
      },
    };
  },
  // Sent to the patient on the lab_orders payment_confirmed transition (see
  // enqueue_lab_order_lab_notifications) — the lab_orders equivalent of
  // pharmacy_order_patient_confirmation. lab_name prefers the chosen physical
  // facility, falling back to the umbrella lab_providers name.
  lab_order_patient_confirmation: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const labName = String(payload.lab_name ?? "the lab");
    const patientName = String(payload.patient_name ?? "there");
    const patientNumber = String(payload.patient_number ?? "");
    const testName = String(payload.test_name ?? "your test");
    const smsText =
      `Hi ${patientName}, your Tarragon Health order ${orderNumber} (${testName}) is confirmed at ${labName}. ` +
      `Show order ${orderNumber} and your patient ID ${patientNumber} when you arrive. ` +
      `Tarragon Health`;
    return {
      metaTemplateName: "lab_order_patient_confirmation",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: orderNumber },
            { type: "text", text: testName },
            { type: "text", text: labName },
            { type: "text", text: patientNumber },
          ],
        },
      ],
      smsText,
      email: {
        subject: `Your Tarragon Health order ${orderNumber} is confirmed`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${patientName},</p>` +
          `<p>Your order is confirmed. Show the details below at <strong>${labName}</strong> when you arrive.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Order number</td><td style="padding:4px 0"><strong>${orderNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient ID</td><td style="padding:4px 0"><strong>${patientNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Test</td><td style="padding:4px 0">${testName}</td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Lab</td><td style="padding:4px 0">${labName}</td></tr>` +
          `</table>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the lab_providers contact (SMS + email) on the same transition —
  // no WhatsApp leg, mirrors pharmacy_order_pharmacy_alert.
  lab_order_lab_alert: (payload) => {
    const orderNumber = String(payload.order_number ?? "");
    const labName = String(payload.lab_name ?? "");
    const facilityName = String(payload.facility_name ?? "");
    const patientName = String(payload.patient_name ?? "a patient");
    const patientNumber = String(payload.patient_number ?? "");
    const testName = String(payload.test_name ?? "");
    const smsText =
      `New Tarragon Health order ${orderNumber}: ${patientName} (patient ID ${patientNumber}): ` +
      `${testName}. Please prepare to receive this patient. Tarragon Health`;
    return {
      metaTemplateName: "lab_order_lab_alert",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: orderNumber }] },
      ],
      smsText,
      email: {
        subject: `New Tarragon Health order ${orderNumber}: ${patientName}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hello ${labName},</p>` +
          `<p>A patient has a confirmed, paid booking${facilityName ? ` at ${facilityName}` : ""}. Please prepare for:</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Order number</td><td style="padding:4px 0"><strong>${orderNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient</td><td style="padding:4px 0">${patientName}</td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient ID</td><td style="padding:4px 0"><strong>${patientNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Test</td><td style="padding:4px 0">${testName}</td></tr>` +
          `</table>` +
          `<p>The patient will present order ${orderNumber} and their patient ID on arrival.</p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health: Care that stays with you.</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the patient on the specialist_referrals payment_confirmed
  // transition (see enqueue_referral_notifications) — the referrals
  // equivalent of pharmacy_order_patient_confirmation.
  referral_patient_confirmation: (payload) => {
    const referralNumber = String(payload.referral_number ?? "your referral");
    const specialistName = String(payload.specialist_name ?? "your specialist");
    const patientName = String(payload.patient_name ?? "there");
    const patientNumber = String(payload.patient_number ?? "");
    const smsText =
      `Hi ${patientName}, your Tarragon Health referral ${referralNumber} to ${specialistName} is confirmed. ` +
      `Your care team will follow up on booking your appointment. Tarragon Health`;
    return {
      metaTemplateName: "referral_patient_confirmation",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: referralNumber },
            { type: "text", text: specialistName },
          ],
        },
      ],
      smsText,
      email: {
        subject: `Your Tarragon Health referral ${referralNumber} is confirmed`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${patientName},</p>` +
          `<p>Your referral is confirmed and on its way to <strong>${specialistName}</strong>. Your care team will follow up ` +
          `to help book your appointment.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Referral number</td><td style="padding:4px 0"><strong>${referralNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient ID</td><td style="padding:4px 0"><strong>${patientNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Specialist</td><td style="padding:4px 0">${specialistName}</td></tr>` +
          `</table>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the specialist_providers contact (SMS + email) on the same
  // transition — no WhatsApp leg, mirrors pharmacy_order_pharmacy_alert /
  // lab_order_lab_alert. referral_reason is short clinical context a
  // receiving specialist needs, same category of operational detail as
  // lab_order_lab_alert's test_name or pharmacy's items_summary.
  referral_specialist_alert: (payload) => {
    const referralNumber = String(payload.referral_number ?? "");
    const specialistName = String(payload.specialist_name ?? "");
    const patientName = String(payload.patient_name ?? "a patient");
    const patientNumber = String(payload.patient_number ?? "");
    const specialistType = String(payload.specialist_type ?? "");
    const referralReason = String(payload.referral_reason ?? "");
    const smsText =
      `New Tarragon Health referral ${referralNumber}: ${patientName} (patient ID ${patientNumber}): ` +
      `${specialistType}. Please expect contact to arrange this patient's appointment. Tarragon Health`;
    return {
      metaTemplateName: "referral_specialist_alert",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: referralNumber }] },
      ],
      smsText,
      email: {
        subject: `New Tarragon Health referral ${referralNumber}: ${patientName}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hello ${specialistName},</p>` +
          `<p>A patient has a confirmed referral to your practice. Please expect our care team to reach out to arrange ` +
          `the appointment:</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Referral number</td><td style="padding:4px 0"><strong>${referralNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient</td><td style="padding:4px 0">${patientName}</td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Patient ID</td><td style="padding:4px 0"><strong>${patientNumber}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Referral type</td><td style="padding:4px 0">${specialistType}</td></tr>` +
          (referralReason
            ? `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Reason</td><td style="padding:4px 0">${referralReason}</td></tr>`
            : "") +
          `</table>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health: Care that stays with you.</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to a waitlisted patient when their state is switched live
  // (private.notify_region_waitlist). A "now available" nudge only — nothing is
  // auto-booked; they open the app to act. Falls back to SMS until the Meta
  // template is approved. care_recipient is set when they were waiting on behalf
  // of a family member (e.g. a diaspora child for a parent in Nigeria).
  region_now_available: (payload) => {
    const state = String(payload.display_name ?? payload.state ?? "your state");
    const rawServices = String(payload.services ?? "");
    const requesterName = String(payload.requester_name ?? "there");
    const careRecipient = payload.care_recipient ? String(payload.care_recipient) : null;

    const SERVICE_WORDS: Record<string, string> = {
      lab: "lab tests",
      pharmacy: "pharmacy orders",
      home_visit: "home sample collection",
      delivery: "medication delivery",
      specialist: "specialist referrals",
    };
    const servicesPretty =
      rawServices
        .split(",")
        .map((s) => SERVICE_WORDS[s.trim()] ?? s.trim())
        .filter((s) => s.length > 0)
        .join(", ") || "our partner services";

    const forWhom = careRecipient ? ` for ${careRecipient}` : "";
    const smsText =
      `Good news ${requesterName}, TarragonHealth is now live in ${state}${forWhom}. ` +
      `You can now book ${servicesPretty} in the app. Tarragon Health`;

    return {
      metaTemplateName: "region_now_available",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: state },
            { type: "text", text: servicesPretty },
          ],
        },
      ],
      smsText,
      email: {
        subject: `TarragonHealth is now live in ${state}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${requesterName},</p>` +
          `<p>Great news, TarragonHealth is now live in <strong>${state}</strong>${careRecipient ? ` for ${careRecipient}` : ""}. ` +
          `The services you asked us to tell you about are ready to book:</p>` +
          `<p style="margin:16px 0"><strong>${servicesPretty}</strong></p>` +
          `<p>Open the Tarragon Health app to book; everything is in one place.</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the patient when a clinician/specialist prescribes a medication
  // (private.enqueue_medication_prescribed_notifications). Email is the
  // guaranteed channel the requirement asks for; WhatsApp is attempted first on
  // the whatsapp row, falling back to SMS until the Meta template is approved.
  medication_prescribed_patient: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const drugName = String(payload.drug_name ?? "your medication");
    const dose = String(payload.dose ?? "");
    const frequency = String(payload.frequency ?? "");
    const details =
      String(payload.details ?? "").trim() ||
      [drugName, dose, frequency].filter((s) => s.length > 0).join(" ");
    const prescriberName = String(payload.prescriber_name ?? "");
    const smsText =
      `Hi ${patientName}, a new medication has been added to your care plan: ${details}. ` +
      `See the full details in the Tarragon Health app. Tarragon Health`;
    return {
      metaTemplateName: "medication_prescribed_patient",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: patientName },
            { type: "text", text: details },
          ],
        },
      ],
      smsText,
      email: {
        subject: `A new medication has been added to your care plan`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${patientName},</p>` +
          `<p>A new medication has been added to your care plan. Here are the details:</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Medication</td><td style="padding:4px 0"><strong>${drugName}</strong></td></tr>` +
          (dose ? `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Dose</td><td style="padding:4px 0">${dose}</td></tr>` : "") +
          (frequency ? `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">How to take it</td><td style="padding:4px 0">${frequency}</td></tr>` : "") +
          (prescriberName ? `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Prescribed by</td><td style="padding:4px 0">${prescriberName}</td></tr>` : "") +
          `</table>` +
          `<p>Open the Tarragon Health app to see your full medication list, reminders, and refill dates.</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the patient for every lab order
  // (private.enqueue_lab_order_requested_notifications). A doctor/system order
  // reads as "requested for you"; a self-booked order reads as a showable
  // confirmation to present at the lab. Email is the guaranteed channel;
  // WhatsApp falls back to SMS until the Meta template lands.
  lab_order_requested_patient: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const orderNumber = String(payload.order_number ?? "your order");
    const testName = String(payload.test_name ?? "a lab test");
    const selfBooked = payload.self_booked === true;
    const lead = selfBooked
      ? `Your lab test order is confirmed. Show order ${orderNumber} at the lab so they know exactly what to run.`
      : `Your care team has requested a lab test for you.`;
    const smsText = selfBooked
      ? `Hi ${patientName}, your lab order is confirmed: ${testName} (order ${orderNumber}). ` +
        `Show order ${orderNumber} at the lab to have it done. Tarragon Health`
      : `Hi ${patientName}, a lab test has been requested for you: ${testName} ` +
        `(order ${orderNumber}). See the details in the Tarragon Health app. Tarragon Health`;
    return {
      metaTemplateName: "lab_order_requested_patient",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: patientName },
            { type: "text", text: testName },
            { type: "text", text: orderNumber },
          ],
        },
      ],
      smsText,
      email: {
        subject: selfBooked
          ? `Your lab test order ${orderNumber} is confirmed`
          : `A lab test has been requested for you`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${patientName},</p>` +
          `<p>${lead} Here are the details:</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Test</td><td style="padding:4px 0"><strong>${testName}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Order number</td><td style="padding:4px 0"><strong>${orderNumber}</strong></td></tr>` +
          `</table>` +
          `<p>Open the Tarragon Health app to see the order, choose where to have it done, and track your results.</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the patient once a Tarragon doctor has confirmed the physical
  // certificate they uploaded — the dose is now Tarragon-verified, their
  // Tarragon certificate is ready to download in the app, and (if the vaccine
  // is part of a series) the next dose has been scheduled. Confirmation only;
  // the certificate itself lives behind app/web auth, never sent over the wire.
  vaccination_verified: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const vaccineName = String(payload.vaccine_name ?? "your vaccination");
    const serial = String(payload.certificate_serial ?? "");
    const nextDose = payload.next_dose_date ? String(payload.next_dose_date) : null;
    const nextLine = nextDose ? ` Your next dose is due ${nextDose}.` : "";
    const smsText =
      `Hi ${patientName}, your ${vaccineName} has been verified by your Tarragon care team ` +
      `(certificate ${serial}). Download it in the app.${nextLine} Tarragon Health`;
    return {
      metaTemplateName: "vaccination_verified",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: vaccineName },
            { type: "text", text: serial },
          ],
        },
      ],
      smsText,
      email: {
        subject: `Your ${vaccineName} is verified: Tarragon certificate ${serial}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${patientName},</p>` +
          `<p>Your Tarragon care team has reviewed the certificate you uploaded and confirmed your ` +
          `<strong>${vaccineName}</strong> dose. Your Tarragon certificate is ready.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Certificate</td><td style="padding:4px 0"><strong>${serial}</strong></td></tr>` +
          (nextDose
            ? `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">Next dose due</td><td style="padding:4px 0">${nextDose}</td></tr>`
            : "") +
          `</table>` +
          `<p>Open the Tarragon Health app to download your certificate${nextDose ? " and book your next dose" : ""}.</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the patient's saved emergency contact / next of kin (SMS + WhatsApp)
  // when the patient reports an emergency and does not acknowledge it within the
  // acknowledge-gated window (private.notify_unacknowledged_emergencies), or
  // immediately via the patient's "Alert my emergency contact now" action. A
  // one-way alert only — TarragonHealth never manages the emergency, it routes
  // the contact to help the patient reach a hospital. `to_phone` in the payload
  // is the contact's number (they are not a platform user).
  emergency_contact_alert: (payload) => {
    const contactName = String(payload.contact_name ?? "there");
    const patientName = String(
      payload.patient_name ?? "someone who lists you as their emergency contact",
    );
    const smsText =
      `${contactName}, this is an urgent alert from Tarragon Health. ${patientName} reported a ` +
      `possible medical emergency and may need your help. Please try to reach them now. If you ` +
      `cannot and it is an emergency, help them get to the nearest hospital. Tarragon Health`;
    return {
      metaTemplateName: "emergency_contact_alert",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: contactName },
            { type: "text", text: patientName },
          ],
        },
      ],
      smsText,
    };
  },
  // Sent to org clinicians when an abnormal/critical screening result lands
  // (private.handle_abnormal_screening_result -> abnormal-result-handler,
  // via private.enqueue_critical_notification — 2026-07-30). Was previously
  // a raw, untracked Meta API call outside this table entirely; now a
  // tracked, critical-priority row that starts on push and force-escalates
  // through the channel ladder if nobody confirms it (see
  // critical_notification_engine.sql). Meta template name unchanged from
  // the prior direct-call implementation, so no new Meta approval needed.
  abnormal_result_clinician_alert: (payload) => {
    const patientName = String(payload.patient_name ?? "A patient");
    const conditionLabel = String(payload.condition_label ?? "an abnormal result");
    return {
      metaTemplateName: "abnormal_result_clinician_alert",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: patientName },
            { type: "text", text: conditionLabel },
          ],
        },
      ],
      smsText:
        `New Priority 1 alert: ${patientName}'s screening result needs review (${conditionLabel}). ` +
        `See your Tarragon Health worklist. Tarragon Health`,
    };
  },
  // Sent to org clinicians when an emergency_events row is raised — any
  // source (danger-symptom checklist, symptom log, ai_coach, BP hypertensive
  // crisis, glucose severe hypo / suspected DKA, SpO2 hypoxia, temperature
  // hyperpyrexia/hypothermia). Centralized in
  // private.handle_emergency_event() (2026-08-07, see
  // vitals_red_flag_notification_wiring migration) via
  // private.enqueue_critical_notification — same tracked, force-escalating
  // pipeline as abnormal_result_clinician_alert above.
  emergency_event_clinician_alert: (payload) => {
    const patientName = String(payload.patient_name ?? "A patient");
    const sourceLabel = String(payload.source_label ?? "an emergency");
    return {
      metaTemplateName: "emergency_event_clinician_alert",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: patientName },
            { type: "text", text: sourceLabel },
          ],
        },
      ],
      smsText:
        `New Priority 1 alert: ${patientName}'s case needs review (${sourceLabel}). ` +
        `See your Tarragon Health worklist. Tarragon Health`,
    };
  },
  // Sent to org clinicians when a RED/AMBER vitals red-flag trigger raises or
  // upgrades a clinician_alerts row (BP, SpO2, or temperature — see
  // private.handle_bp_reading_red_flag / handle_spo2_reading_red_flag /
  // handle_temperature_reading_red_flag, wired 2026-08-07). Shared across all
  // three vital types; the payload carries which one and how urgent.
  vitals_red_flag_clinician_alert: (payload) => {
    const patientName = String(payload.patient_name ?? "A patient");
    const vitalLabel = String(payload.vital_label ?? "a vital sign reading");
    const levelLabel = String(payload.level_label ?? "Review needed");
    return {
      metaTemplateName: "vitals_red_flag_clinician_alert",
      languageCode: "en",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: levelLabel },
            { type: "text", text: patientName },
            { type: "text", text: vitalLabel },
          ],
        },
      ],
      smsText:
        `${levelLabel}: ${patientName}'s ${vitalLabel} needs review. ` +
        `See your Tarragon Health worklist. Tarragon Health`,
    };
  },
  // Sent as the "extra channel" nudge (push/whatsapp/sms, generic non-PHI
  // copy only — the real alert detail stays in the in_app row, which never
  // routes through this function at all) when
  // private.escalate_unacknowledged_clinician_alerts() (20260828015134)
  // climbs a rung of the ack-timeout ladder: hop 1 = the alert's backup
  // clinician, hop 2 = senior tier/Clinical Director, hop 3 = every
  // platform admin. private.notify_clinician_alert() always fans these out
  // with the same fixed message regardless of which hop fired, so all three
  // templates share this shape — only the audience (and therefore which
  // template key gets used) differs, same pattern as the clinician-alert
  // templates above.
  clinician_alert_ack_timeout_backup: (payload) => {
    const message = String(
      payload.message ?? "An unacknowledged alert needs your attention.",
    );
    return {
      metaTemplateName: "clinician_alert_ack_timeout_backup",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: message }] }],
      smsText: `${message} See your Tarragon Health worklist. Tarragon Health`,
      pushUrl: "/clinician/escalations",
    };
  },
  clinician_alert_ack_timeout_senior: (payload) => {
    const message = String(
      payload.message ?? "An unacknowledged alert has escalated to you.",
    );
    return {
      metaTemplateName: "clinician_alert_ack_timeout_senior",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: message }] }],
      smsText: `${message} See your Tarragon Health worklist. Tarragon Health`,
      pushUrl: "/clinician/escalations",
    };
  },
  clinician_alert_ack_timeout_admin: (payload) => {
    const message = String(
      payload.message ?? "An alert has gone unacknowledged past its escalation timeout.",
    );
    return {
      metaTemplateName: "clinician_alert_ack_timeout_admin",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: message }] }],
      smsText: `${message} See your Tarragon Health worklist. Tarragon Health`,
      pushUrl: "/clinician/escalations",
    };
  },
  // Sent to the patient after the follow-up window on an emergency event
  // (private.notify_emergency_followups). Gentle check-in nudging them to update
  // their care team in the app — the follow-up itself happens in-app, never over
  // WhatsApp/SMS.
  emergency_followup: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const smsText =
      `Hi ${patientName}, we noticed you recently reported an emergency. We hope you're okay. ` +
      `When you can, open the Tarragon Health app to let your care team know how you're doing. ` +
      `Tarragon Health`;
    return {
      metaTemplateName: "emergency_followup",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: patientName }] },
      ],
      smsText,
    };
  },
  // Sent every calendar day the patient's live emergency-card link is actually
  // viewed (public.emergency_card_by_token, deduped to one per day so a single
  // hospital visit scanning it several times doesn't spam them). in_app +
  // email only — this is a security-style notice, not a reminder, and works
  // via the in_app leg the moment it's queued regardless of this function's
  // own deploy state (in_app rows are never routed through this sender at
  // all — see the channel filter above).
  emergency_card_viewed: (payload) => {
    const on = String(payload.viewed_on ?? "today");
    const smsText = `Tarragon Health: your emergency card link was viewed on ${on}. If that wasn't expected, replace it at any time from your dashboard.`;
    return {
      metaTemplateName: "emergency_card_viewed",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: on }] }],
      smsText,
      pushUrl: "/patient/emergency-card",
      email: {
        subject: "Your emergency card was viewed",
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Your emergency card link was opened on ${on}.</p>` +
          `<p style="color:#5b6b78;font-size:13px">This is expected if you or a hospital scanned it while you were being treated. If it wasn't expected, you can replace the link at any time from your Emergency card page &mdash; the old one stops working immediately.</p>` +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
      },
    };
  },
  // Sent 30 days before a live emergency-card link expires
  // (private.queue_emergency_card_expiry_nudges). The printed/offline card
  // this pairs with is unaffected by this expiry — it's mentioned explicitly
  // so a lapsing live link never reads as "your whole emergency card is gone".
  emergency_card_expiring_soon: () => {
    const smsText =
      "Tarragon Health: your emergency card live link expires in 30 days. Replace it to keep it working. Your printed card is unaffected.";
    return {
      metaTemplateName: "emergency_card_expiring_soon",
      languageCode: "en",
      components: [{ type: "body", parameters: [] }],
      smsText,
      pushUrl: "/patient/emergency-card",
      email: {
        subject: "Your emergency card link expires soon",
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Your emergency card live link expires in about 30 days.</p>` +
          `<p style="color:#5b6b78;font-size:13px">Replace it from your Emergency card page to keep it working for another 12 months. If you'd rather let it lapse, that's fine &mdash; your printed card is unaffected either way.</p>` +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
      },
    };
  },
};

interface SendResult {
  ok: boolean;
  error?: string;
  // Meta's wamid (WhatsApp only) — captured so the whatsapp-webhook
  // extension can correlate a later delivery/read status callback back to
  // this row. Nothing else currently produces a provider-side message id
  // worth storing (web push has no per-message receipt to correlate).
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

async function sendWhatsApp(
  toPhone: string,
  render: TemplateRender,
): Promise<SendResult> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) {
    return { ok: false, error: "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured" };
  }

  const result = await withExternalCall((signal) =>
    fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone,
        type: "template",
        template: {
          name: render.metaTemplateName,
          language: { code: render.languageCode },
          components: render.components,
        },
      }),
    })
  );

  if (!result.ok || !result.response) return result;
  try {
    const body = await result.response.json() as { messages?: Array<{ id?: string }> };
    const messageId = body.messages?.[0]?.id;
    return { ok: true, messageId };
  } catch {
    // Meta's own contract guarantees this shape on 2xx — a parse failure
    // here is not worth failing the send over, just leaves messageId unset.
    return { ok: true };
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
 * transparently turns a queued 'whatsapp' row into 'voice' at insert time
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
 * WHATSAPP_TOKEN/TERMII_API_KEY/RESEND_API_KEY there is no provider account
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
): Promise<SendResult & { goneSubscriptionIds: string[] }> {
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

  type ExpoTicket = { status: "ok" | "error"; message?: string; details?: { error?: string } };
  let tickets: ExpoTicket[];
  try {
    const json = (await result.response.json()) as { data?: ExpoTicket[] };
    tickets = json.data ?? [];
  } catch {
    return { ok: false, error: "invalid expo push response", goneSubscriptionIds: [] };
  }

  const goneSubscriptionIds: string[] = [];
  let anyOk = false;
  let lastError: string | undefined;
  tickets.forEach((ticket, i) => {
    if (ticket.status === "ok") {
      anyOk = true;
      return;
    }
    lastError = ticket.message ?? "expo push ticket error";
    if (ticket.details?.error === "DeviceNotRegistered") {
      goneSubscriptionIds.push(subscriptions[i].id);
    }
  });

  return anyOk
    ? { ok: true, goneSubscriptionIds }
    : { ok: false, error: lastError ?? "expo push send failed", goneSubscriptionIds };
}

async function sendEmail(
  toEmail: string,
  subject: string,
  html: string,
  text: string,
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

  return withExternalCall((signal) =>
    fetch("https://api.resend.com/emails", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [toEmail], subject, html, text }),
    })
  );
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending, error: fetchError } = await supabase
    .from("notifications")
    .select("id, recipient_id, channel, template, payload, attempts, priority")
    .eq("status", "pending")
    .in("channel", ["whatsapp", "sms", "email", "voice", "push"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE)
    .returns<NotificationRow[]>();

  if (fetchError) {
    return Response.json(
      { processed: 0, sent: 0, retried: 0, failed: 0, error: fetchError.message },
      { status: 200 },
    );
  }

  const rows = pending ?? [];
  if (rows.length === 0) {
    return Response.json({ processed: 0, sent: 0, retried: 0, failed: 0 });
  }

  const recipientIds = [...new Set(rows.map((row) => row.recipient_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, phone")
    .in("id", recipientIds)
    .returns<Array<{ id: string; phone: string | null }>>();
  const phoneById = new Map((profiles ?? []).map((p) => [p.id, p.phone]));

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

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
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

    const renderFn = row.template ? TEMPLATE_MAP[row.template] : undefined;
    if (!renderFn) {
      await markFailed("unknown template");
      failed++;
      continue;
    }

    const payload = row.payload ?? {};
    const render = renderFn(payload);

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
      await settle(await sendEmail(toEmail, render.email.subject, render.email.html, render.email.text));
    } else if (row.channel === "push") {
      const subs = subscriptionsByProfile.get(row.recipient_id) ?? [];
      const pushBody = render.smsText.length > PUSH_BODY_MAX_CHARS
        ? `${render.smsText.slice(0, PUSH_BODY_MAX_CHARS - 1)}…`
        : render.smsText;
      const pushPayload = {
        title: "Tarragon Health",
        body: pushBody,
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

      if (!pushResult.ok && !isCritical) {
        // Routine rows: push is the default channel, but a routine reminder
        // doesn't need confirmation-gated escalation — fall back inline to
        // whatsapp -> sms, same simple best-effort delivery this codebase
        // already used for whatsapp -> sms.
        if (!toPhone) {
          await markFailed("recipient has no phone number on file");
          failed++;
          continue;
        }
        let fallback = await sendWhatsApp(toPhone, render);
        if (!fallback.ok) fallback = await sendTermiiSms(toPhone, render.smsText);
        await settle(fallback);
      } else {
        // Critical rows: no inline fallback — a failed push here becomes its
        // own `failed` row that the escalation engine turns into a fresh,
        // separately-tracked whatsapp hop within the next 2 minutes.
        await settle(pushResult);
      }
    } else if (row.channel === "whatsapp") {
      if (!toPhone) {
        await markFailed("recipient has no phone number on file");
        failed++;
        continue;
      }
      let result = await sendWhatsApp(toPhone, render);
      if (!result.ok && !isCritical) {
        // WhatsApp delivery failed — fall back to Termii SMS (§8). Critical
        // rows skip this (see the push branch's comment above) so the
        // engine's next hop is its own tracked row, not silently absorbed.
        result = await sendTermiiSms(toPhone, render.smsText);
      }
      await settle(result);
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

  return Response.json({ processed: rows.length, sent, retried, failed });
});
