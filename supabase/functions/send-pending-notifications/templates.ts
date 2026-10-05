// Tarragon Health: notification template renderers, split out of index.ts in S13 so a test can render every
// template and prove none puts a condition, reading, drug or result in the text (INV-07). Behaviour is unchanged.
import { createHmac } from "node:crypto";
import { resolveI18n } from "../_shared/i18n/resolve.ts";

// Patient-experience review 2026-07-31: several reminder templates only ever
// said "open the app" with no actual link — real friction for a patient
// trying to act on an SMS/push nudge. This builds a real deep link
// into smsText (shared by SMS, push, and voice — see the dispatch loop
// below). Deliberately its own APP_BASE_URL, distinct
// from the marketing site's NEXT_PUBLIC_SITE_URL (root domain) — these
// links point at the platform's `app.` subdomain. Set on BOTH .env.local
// (local dev) and this function's own Supabase Edge Function secrets store
// — they do not share a source, per the Stripe-webhook lesson elsewhere in
// this codebase. Falls back to the production app domain so a missing
// secret still produces a working link rather than a broken one.
export function appUrl(path: string): string {
  const base = Deno.env.get("APP_BASE_URL") ?? "https://app.tarragonhealth.ng";
  return `${base}${path}`;
}

// Shared Africa/Lagos date/time formatting, factored out of the appointment
// templates below (six new call sites made the inline IIFE annual_review_
// consult_scheduled/video_consult_booked each used their own copy of worth
// sharing rather than repeating a seventh and eighth time).
export function formatLagosDateTime(raw: unknown): string {
  const d = new Date(String(raw ?? ""));
  return Number.isNaN(d.getTime())
    ? "the scheduled time"
    : d.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
}

// public.appointment_type enum labels (appointment_engine_types.sql) for the
// Appointment Engine templates below.
export const APPOINTMENT_TYPE_LABEL: Record<string, string> = {
  gp: "GP appointment",
  specialist: "specialist appointment",
  nurse: "nurse appointment",
  dietitian: "dietitian appointment",
  physiotherapist: "physiotherapy appointment",
  laboratory: "lab appointment",
  imaging: "imaging appointment",
  vaccination: "vaccination appointment",
  physical_clinic: "clinic appointment",
  telemedicine: "video appointment",
  follow_up: "follow-up appointment",
  procedure: "procedure appointment",
};

// Health Communication Engine — DB-driven template fallback (17.5). Every
// template above is a hardcoded TEMPLATE_MAP entry; this substitutes
// `{{token}}` in a notification_template_locales row's body/subject against
// the notification's own payload, for a template key that was never added
// to TEMPLATE_MAP at all. Deliberately dumb (no conditionals, no loops,
// just a flat key lookup) — anything requiring real logic still needs a
// real TEMPLATE_MAP entry.
export function substituteTemplatePlaceholders(text: string, payload: Record<string, unknown>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export interface TemplateRender {
  smsText: string;
  // Present only for templates that fan out to the `email` channel. Absent
  // for the legacy reminder templates, which are SMS/push only — an email
  // row referencing a template without this is failed with a clear reason.
  email?: { subject: string; html: string; text?: string };
  // Present only where a template author has bothered to compute a specific
  // in-app destination (see the push-channel dispatch below, which otherwise
  // falls back to the bare "/" every push notification used before
  // 2026-07-31 — tapping a reminder just opened the homepage regardless of
  // what it was about). Deliberately opt-in per template rather than a
  // blanket default, so untouched templates keep their exact prior behavior.
  pushUrl?: string;
}

// ---------------------------------------------------------------------------
// Broadcast branded-email template builder — KEEP IN SYNC WITH
// apps/web/src/lib/broadcasts/render-email-template.ts (the admin composer's
// live preview in the confirm dialog). Both must produce structurally
// identical HTML for the same input, or an admin's preview lies about what
// recipients actually get. No react-email here (not installed, and this file
// runs on Deno while the web app is Node/Next) — plain template-literal HTML,
// matching this file's own established no-shared-module pattern (every other
// TEMPLATE_MAP entry below inlines its own HTML rather than importing a
// shared renderer). See notification_broadcasts.email_content's column
// comment (migration 20260912220307) for the full field contract.
// ---------------------------------------------------------------------------
export interface BroadcastEmailContent {
  headline: string;
  bodyText: string;
  imageUrl?: string;
  bandColor?: "green" | "navy" | "none";
  buttonText?: string;
  buttonUrl?: string;
  footerNote?: string;
}

export function escapeHtmlForBroadcast(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderBroadcastEmailHtml(
  content: BroadcastEmailContent | null | undefined,
  fallbackSubject: string,
  fallbackBody: string,
): string {
  const escapeHtml = escapeHtmlForBroadcast;

  // No email_content: today's exact plain rendering, byte-for-byte, so a
  // broadcast drafted/queued before this column existed (or any admin who
  // just leaves the email-design section untouched) is unaffected.
  if (!content) {
    const bodyHtml = escapeHtml(fallbackBody).replace(/\n/g, "<br>");
    return (
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
      `<h2 style="color:#0E7C52;margin:0 0 12px">${escapeHtml(fallbackSubject)}</h2>` +
      `<p>${bodyHtml}</p>` +
      `<p style="color:#0E7C52;margin-top:20px"><strong>Care that stays with you.</strong></p>` +
      `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
      `</div>`
    );
  }

  const band = content.bandColor ?? "none";
  const bandBg = band === "green" ? "#0E7C52" : band === "navy" ? "#12324B" : null;

  const imageHtml = content.imageUrl
    ? `<img src="${escapeHtml(content.imageUrl)}" alt="" style="width:100%;display:block;margin:0 0 16px;border-radius:8px" />`
    : "";

  const headlineHtml = bandBg
    ? `<div style="background:${bandBg};padding:16px 20px;border-radius:8px;margin:0 0 16px"><h2 style="color:#ffffff;margin:0">${escapeHtml(content.headline)}</h2></div>`
    : `<h2 style="color:#0E7C52;margin:0 0 12px">${escapeHtml(content.headline)}</h2>`;

  const bodyParagraphs = content.bodyText
    .split(/\n\s*\n/)
    .filter((para) => para.trim().length > 0)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const buttonHtml =
    content.buttonText && content.buttonUrl
      ? `<p style="margin-top:20px"><a href="${escapeHtml(content.buttonUrl)}" style="background:#0E7C52;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(content.buttonText)}</a></p>`
      : "";

  const footerNoteHtml = content.footerNote
    ? `<p style="color:#5b6b78;font-size:13px;margin-top:4px">${escapeHtml(content.footerNote)}</p>`
    : "";

  return (
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5;max-width:600px">` +
    imageHtml +
    headlineHtml +
    bodyParagraphs +
    buttonHtml +
    `<p style="color:#0E7C52;margin-top:20px"><strong>Care that stays with you.</strong></p>` +
    `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
    footerNoteHtml +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// Broadcast link signing — KEEP IN SYNC WITH
// apps/web/src/lib/broadcasts/link-token.ts (the Node copy the unsubscribe/
// track-open/track-click routes verify against). Uses node:crypto's
// synchronous createHmac (Deno's own crypto.subtle API — see
// supabase/functions/zoom-webhook/index.ts's hmacHex — is async, which would
// force every TEMPLATE_MAP handler to become async just for this one
// template; the Node-compat createHmac keeps this handler, and every other
// one, synchronous). Every message is namespaced by purpose so a token
// minted for one purpose can never be replayed as another; a click token
// signs the destination URL itself so a valid signature can't be reused to
// redirect somewhere the admin never set. No expiry — these links are
// mailed out and must keep working whenever the recipient opens the email,
// days or months later.
// ---------------------------------------------------------------------------
export function broadcastLinkSecret(): string {
  return Deno.env.get("BROADCAST_LINK_SECRET") ?? "";
}

// Returns null (never a token signed with an empty/missing secret) when
// BROADCAST_LINK_SECRET isn't configured — the caller below then simply
// omits the corresponding link/pixel rather than emitting a broken or
// forgeable one. Matches this file's established graceful-degradation
// posture for a missing credential (see RESEND_API_KEY et al.).
export function signBroadcastLinkMessage(message: string): string | null {
  const secret = broadcastLinkSecret();
  if (!secret) return null;
  const signature = createHmac("sha256", secret).update(message).digest("base64url");
  return `${message}.${signature}`;
}

export function buildBroadcastUnsubscribeUrl(profileId: string): string | null {
  const token = signBroadcastLinkMessage(`unsub:${profileId}`);
  if (!token) return null;
  return appUrl(
    `/api/broadcasts/unsubscribe?profile_id=${encodeURIComponent(profileId)}&token=${encodeURIComponent(token)}`
  );
}

export function buildBroadcastOpenTrackingUrl(notificationId: string): string | null {
  const token = signBroadcastLinkMessage(`open:${notificationId}`);
  if (!token) return null;
  return appUrl(
    `/api/broadcasts/track-open?notification_id=${encodeURIComponent(notificationId)}&token=${encodeURIComponent(token)}`
  );
}

export function buildBroadcastClickTrackingUrl(notificationId: string, targetUrl: string): string | null {
  const token = signBroadcastLinkMessage(`click:${notificationId}:${targetUrl}`);
  if (!token) return null;
  return appUrl(
    `/api/broadcasts/track-click?notification_id=${encodeURIComponent(notificationId)}&url=${encodeURIComponent(targetUrl)}&token=${encodeURIComponent(token)}`
  );
}

// Second argument every TEMPLATE_MAP handler now COULD receive — only
// broadcast_announcement actually uses it today. Existing handlers keep
// their original 1-argument signatures unchanged: a function with fewer
// declared parameters than a type's call signature is structurally
// assignable to it (JS silently drops extra call arguments), so none of the
// ~25 other entries below needed touching.
export interface TemplateRenderContext {
  notificationId: string;
  recipientId: string;
}


// ---------------------------------------------------------------------------
// S13 (INV-07): wording below never names a condition, reading, medicine or result. A push, an email and an
// in-app preview are all read on a lock screen or a shared phone, so the detail lives behind the app lock and
// these only say that something is waiting. `neutral.test.ts` renders every template and fails on a clinical term.
// ---------------------------------------------------------------------------
const MAIL_FRAME = (inner: string): string =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
  inner +
  `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
  `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p></div>`;

const MAIL_ROWS = (rows: ReadonlyArray<readonly [string, string]>): string =>
  rows.length === 0
    ? ""
    : `<table style="border-collapse:collapse;margin:16px 0">` +
      rows
        .filter(([, v]) => v.length > 0)
        .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#5b6b78">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`)
        .join("") +
      `</table>`;

function neutralMail(
  subject: string,
  lines: readonly string[],
  rows: ReadonlyArray<readonly [string, string]> = [],
): { subject: string; html: string; text: string } {
  return {
    subject,
    html: MAIL_FRAME(lines.map((l) => `<p>${l}</p>`).join("") + MAIL_ROWS(rows)),
    text: [...lines, ...rows.filter(([, v]) => v.length > 0).map(([k, v]) => `${k}: ${v}`), "Tarragon Health"].join("\n"),
  };
}

const REMINDER_WAITING = (): string => "Hi, a reminder is waiting for you. Open the Tarragon Health app. Tarragon Health";

// Unknown template keys are never guessed at — see the caller below.
export const TEMPLATE_MAP: Record<
  string,
  (payload: Record<string, unknown>, ctx: TemplateRenderContext) => TemplateRender
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
      smsText:
        `Hi, it's time for your check-in (due ${dueDate}). ` +
        "Open the Tarragon Health app to log it. Tarragon Health",
      pushUrl: path,
    };
  },
  // Sent by the daily lifestyle-coaching cron (coaching-run.ts via
  // messaging-gateway.ts) when a patient's engagement signals call for a
  // supportive nudge. `message` is LLM-personalised copy when available
  // (coaching-proposer.ts) — already screened by toneGuard before this row
  // was ever queued — falling back to a generic check-in line when absent
  // (rules-only decision, or the LLM call failed).
  lifestyle_nudge: (payload) => {
    const message = String(
      payload.message ??
        "Checking in on your lifestyle programme; log a quick update when you get a chance.",
    );
    const path = "/patient/lifestyle";
    return {
      smsText: `${message} Tarragon Health`,
      pushUrl: path,
    };
  },
  // S08 (INV-07): the wording names no medicine. The producer
  // (private.queue_medication_refill_reminders) no longer puts drug_name in the
  // payload, and this template would not use it if an older row still carried one.
  // S13b: sent once by private.queue_push_email_fallbacks() when a routine push was accepted but never opened. It never
  // repeats or hints at the original message.
  push_unconfirmed_email_nudge: (payload) => {
    const name = String(payload.patient_name ?? "there");
    return {
      smsText: "Hi, something is waiting for you in the Tarragon Health app. Open the app to see it. Tarragon Health",
      email: neutralMail("Something is waiting in your Tarragon Health app", [`Hi ${name},`, "Something is waiting for you in the Tarragon Health app. Open the app to see it."]),
    };
  },
  medication_refill_reminder: (payload) => {
    const path = "/patient/medications";
    const when = String(payload.refill_date ?? "");
    return {
      smsText: when ? `Hi, a reminder is due ${when}. Open the Tarragon Health app. Tarragon Health` : REMINDER_WAITING(),
      pushUrl: path,
    };
  },
  booking_reminder: (payload) => {
    const facilityName = String(payload.facility_name ?? "your facility");
    const serviceType = String(payload.service_type ?? "your appointment");
    const requestedDate = String(payload.requested_date ?? "soon");
    const daysBefore = String(payload.days_before ?? "");
    return {
      smsText:
        `Hi, reminder: your request at ${facilityName} is for ${requestedDate} ` +
        `(${daysBefore} day${daysBefore === "1" ? "" : "s"} from now). ` +
        `Open the app to reply. Tarragon Health`,
    };
  },
  // Sent to the patient as a scheduled adherence check-in comes due (see
  // private.queue_medication_checkin_reminders). Reminds them to answer the
  // check-in in the app — the response is never captured over SMS.
  medication_adherence_checkin: () => {
    const path = "/patient/medications";
    return { smsText: `Hi, a quick check-in is waiting for you. Open the app to answer it. Tarragon Health`, pushUrl: path };
  },
  // No counts, no names and no reason: a nudge never shames, and never says what it is about.
  missed_dose_behavioural_nudge: () => {
    const path = "/patient/medications";
    return { smsText: `Hi, your care team left you a note in the app. Open it when you can. Tarragon Health`, pushUrl: path };
  },
  medication_review_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return { smsText: `Hi, a review with your care team is due ${dueDate}. Open the app to see details. Tarragon Health` };
  },
  vaccination_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a reminder is due ${dueDate}. Open the Tarragon Health app to book or log it. Tarragon Health`,
      pushUrl: "/patient/prevention",
    };
  },
  screening_due: (payload) => {
    const screenTypeName = String(payload.screen_type_name ?? "a screening");
    const dueDate = String(payload.due_date ?? "soon");
    const path = "/patient/prevention";
    return {
      smsText:
        `Hi, a reminder is due ${dueDate}. Open the Tarragon Health app to book it. ` +
        `Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent ~1 month before a patient's next annual Health Check (Core/Advanced/
  // Comprehensive Screen) is due — see
  // private.queue_health_check_due_reminders. Reminder only — ordering the
  // check and uploading the result always happen in-app, never over
  // SMS.
  health_check_due_soon: (payload) => {
    const bundleName = String(payload.bundle_name ?? "your annual Health Check");
    const dueDate = String(payload.due_date ?? "soon");
    const path = "/patient/prevention#health-check";
    return {
      smsText:
        `Hi, your annual check-up is due ${dueDate}, about a month from now. Open the Tarragon ` +
        `Health app to book it in good time. Tarragon Health`,
      pushUrl: path,
    };
  },
  // Sent to a patient on an active diabetes care plan when a retinal or
  // renal (kidney) complication check is overdue, or has never been done
  // (see private.queue_diabetes_complication_reminders). Reminder only —
  // the check itself is recorded by a clinician in-app, never over
  // SMS.
  diabetes_complication_check_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a check is due ${dueDate}. Your care team can arrange it at your next visit. Open the app for details. Tarragon Health`,
      pushUrl: "/patient/vitals",
    };
  },
  risk_signal_attention: (payload) => {
    const path = "/patient";
    return {
      smsText:
        "Hi, your care team noticed something that needs a little attention. They are aware; open the Tarragon Health app to see more. Tarragon Health",
      pushUrl: path,
    };
  },
  // Sent to the patient when their care team replies in an in-app message
  // thread. Notification only — the message itself is read in the app, never
  // over SMS.
  new_care_message: () => {
    return {
      smsText:
        "You have a new message from your care team. Open the Tarragon Health app to read and " +
        "reply. Tarragon Health",
    };
  },
  // Sent to the patient as a scheduled periodic health review comes due (see
  // private.queue_preventive_review_reminders). Reminder only — the review is
  // completed by a doctor in the clinician worklist, never in a chat app.
  preventive_review_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText:
        `Hi, your preventive health review is due ${dueDate}. Your care team will be in touch; ` +
        `open the app to see details. Tarragon Health`,
    };
  },
  // Sent to an entitled patient when their yearly Annual Health Review cycle
  // opens (see private.queue_annual_reviews). Reminder only — the review runs
  // through the in-app clinician worklist, never in a chat app.
  annual_review_due: (payload) => {
    const cycleYear = String(payload.cycle_year ?? "this year");
    return {
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
      smsText:
        `Your Annual Health Review video consult is confirmed for ${when}. ` +
        `The join link is in the Tarragon Health app. Tarragon Health`,
    };
  },
  // Sent to the patient as a lifestyle programme review comes due (see
  // private.queue_lpe_review_reminders). Reminder only — the review is
  // completed by their care team in-app, never in a chat app.
  lifestyle_review_due: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
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
      smsText:
        "Hi, your recent health record suggests a quick check-in would help. Open the " +
        "Tarragon Health app to see what's due; booking takes a minute. Tarragon Health",
    };
  },
  // Patient Engagement Engine (§16.6/§16.13) — personalized reminder on a
  // patient's first low-engagement reading (see
  // private.queue_engagement_interventions). `lowest_dimension` names
  // whichever area is dragging the composite down, so the copy points at
  // something specific and actionable — the spec's own example ("Your blood
  // pressure reading is due today. It takes about one minute.") rather than a
  // vague "review your care obligations."
  engagement_reminder_personalized: (payload) => {
    const dimension = typeof payload.lowest_dimension === "string" ? payload.lowest_dimension : null;
    const DIMENSION_COPY: Record<string, string> = {
      monitoring: "It looks like a monitoring reading is overdue — logging one takes about a minute.",
      appointments: "You've got an appointment that could use a bit of attention.",
      medication: "A medication check-in is waiting — a quick answer helps your care team keep track.",
      lifestyle: "It's been a little quiet on your lifestyle log — even a small update helps.",
      prevention: "A screening or vaccination on your schedule is coming up.",
      app_usage: "We haven't seen you in a little while — everything OK?",
      messages: "There's a message from your care team waiting on a reply.",
      care_plan: "There's a step on your care plan that's still open.",
    };
    const message =
      (dimension && DIMENSION_COPY[dimension]) ||
      "A quick check-in on your health record would help keep things on track.";
    return {
      smsText: `${message} Open the Tarragon Health app. Tarragon Health`,
      pushUrl: "/patient",
    };
  },
  // Sent once a patient's low engagement has repeated across 3+ nightly
  // checks — a softer, help-offering tone rather than the same reminder
  // again (spec §16.6's Patient B example: "You've missed several BP
  // readings. Would you like help setting up a simpler routine?").
  engagement_support_offer: (payload) => {
    const dimension = typeof payload.lowest_dimension === "string" ? payload.lowest_dimension : null;
    const DIMENSION_COPY: Record<string, string> = {
      monitoring: "your monitoring readings",
      appointments: "your appointments",
      medication: "your medication check-ins",
      lifestyle: "your lifestyle log",
      prevention: "your screenings and vaccinations",
      app_usage: "checking in on the app",
      messages: "replying to your care team",
      care_plan: "your care plan",
    };
    const area = (dimension && DIMENSION_COPY[dimension]) || "keeping up with your care plan";
    const message = `We've noticed it's been a bit of a stretch with ${area}. Would a simpler routine help? Your care team is happy to talk it through.`;
    return {
      smsText: `${message} Open the Tarragon Health app, or message your care team. Tarragon Health`,
      pushUrl: "/patient",
    };
  },
  // Sent when a patient has gone quiet AND recent notification attempts on
  // their preferred channel haven't landed (compute_care_engagement_scores'
  // 'unreachable' level) — tried on a different channel than usual, on the
  // theory the usual one may simply not be working for them right now.
  engagement_alternative_channel_checkin: () => {
    const message =
      "We've been trying to reach you and wanted to check in a different way — is everything OK?";
    return {
      smsText: `${message} Open the Tarragon Health app, or reply here. Tarragon Health`,
    };
  },
  // S22 written questions and clinical notes. Push and in-app text only (INV-08: never SMS), neutral (INV-07):
  // no question text, condition, reading, result or medicine. The retired async_consult_answered SMS template is gone.
  written_question_received: () => ({
    smsText: "Your care team has your message. Open the Tarragon Health app for the time to expect a reply.",
    pushUrl: "/patient/care",
  }),
  lab_result_corrected: () => ({
    smsText: "Your care team has updated something in your health record. Open the Tarragon Health app to see what changed.",
    pushUrl: "/patient/labs",
  }),
  lab_result_ready: () => ({
    smsText: "Your care team has added something to your health record. Open the Tarragon Health app to see it.",
    pushUrl: "/patient/labs",
  }),
  written_question_answered: () => ({
    smsText: "Your care team has replied. Open the Tarragon Health app to read it.",
    pushUrl: "/patient/care",
  }),
  written_question_info_needed: () => ({
    smsText: "Your care team has a question for you. Open the Tarragon Health app to answer it.",
    pushUrl: "/patient/care",
  }),
  written_question_window_missed: () => ({
    smsText: "Sorry for the wait. Your message is still with the team. Open the Tarragon Health app.",
    pushUrl: "/patient/care",
  }),
  written_question_call_planned: () => ({
    smsText: "Your care team will call you. Keep your phone close.",
    pushUrl: "/patient/care",
  }),
  written_question_staff_notice: () => ({
    smsText: "A written message needs attention. Open your queue.",
    pushUrl: "/clinician/async-consults",
  }),
  note_correction_requested: () => ({
    smsText: "A patient asked for a correction to a signed note. Open your messages to answer.",
    pushUrl: "/clinician/messages",
  }),
  note_release_requested: () => ({
    smsText: "A patient asked about a signed note. Open your messages to answer.",
    pushUrl: "/clinician/messages",
  }),
  note_released: () => ({
    smsText: "Your care team has made a note available. Open the Tarragon Health app to read it.",
    pushUrl: "/patient/care",
  }),
  note_release_declined: () => ({
    smsText: "Your care team has replied to your request. Open the Tarragon Health app to see the reply.",
    pushUrl: "/patient/care",
  }),
  note_correction_answered: () => ({
    smsText: "Your care team has replied to your request. Open the Tarragon Health app to see the reply.",
    pushUrl: "/patient/care",
  }),
  note_unsigned_reminder: () => ({
    smsText: "A note is waiting for your signature.",
    pushUrl: "/clinician/patients",
  }),
  // S24 care plan changes. Push and in-app only (INV-08), neutral (INV-07): the payload is ids only and is never echoed.
  care_change_ready_patient: () => ({
    smsText: "Your care team has a change for you. Open the Tarragon Health app to read it.",
    pushUrl: "/patient/medications",
  }),
  // S11f: private.queue_triage_recheck_backup_reminders() queues this (push, or in_app when there is no push subscription, plus an in_app
  // copy) when a patient told to rest and measure again after 2 hours has still not done so, ten minutes after the phone's own reminder
  // was due. INV-07: no condition, reading or number in any channel's wording.
  triage_recheck_due: () => ({
    smsText: "Hi, it is time for your check-in. Open the Tarragon Health app to continue. Tarragon Health",
    pushUrl: "/patient/vitals",
  }),
  care_change_declined_staff: () => ({
    smsText: "A patient answered a change. Nothing was changed. Open your patient list.",
    pushUrl: "/clinician/patients",
  }),
  care_change_expired_staff: () => ({
    smsText: "A signed change lapsed. Nothing was changed. Open your patient list.",
    pushUrl: "/clinician/patients",
  }),
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
      smsText:
        "Your doctor offered different times for your video visit. Pick one in the app within 24 hours, or you'll be refunded in full. Tarragon Health",
    };
  },
  // Sent when a doctor declines a paid video-visit request, or nobody
  // confirmed a time within 24h (decline action / video-visit-refunds cron).
  // The refund is automatic; this just tells the patient honestly what happened.
  video_visit_declined: (payload) => {
    return {
      smsText:
        "We couldn't schedule your video visit. " +
        `Your payment will be refunded in full. You can request another time in the app. Tarragon Health`,
    };
  },
  // Admin broadcast / announcement (see public.admin_send_broadcast). Free-text
  // subject + body chosen by an admin, fanned out to a resolved audience. Email
  // renders the body as-is.
  broadcast_announcement: (payload, ctx) => {
    const subject = String(payload.subject ?? "A message from Tarragon Health");
    const body = String(payload.body ?? "");
    // email_content is optional/nullable (see admin_send_broadcast) — absent
    // for every broadcast queued before this column existed, or when an
    // admin leaves the email-design section untouched. renderBroadcastEmailHtml
    // falls back to the exact plain rendering this handler always produced.
    const rawEmailContent = payload.email_content;
    const emailContent: BroadcastEmailContent | null =
      rawEmailContent && typeof rawEmailContent === "object" && !Array.isArray(rawEmailContent)
        ? (rawEmailContent as BroadcastEmailContent)
        : null;
    // is_partner distinguishes a patient recipient from a pharmacy/
    // specialist partner billing contact (private.broadcast_targets, threaded
    // into this payload by admin_send_broadcast/private.execute_broadcast).
    // Unsubscribe and tracking are patient-only: marketing_opt_in is a
    // patient-only column, and a partner billing address has no notification
    // row's own recipient that "unsubscribing" would mean anything for.
    const isPartner = payload.is_partner === true;
    const notificationId = ctx.notificationId;
    const recipientId = ctx.recipientId;

    // Click-through tracking on the CTA button, if any: reroute its href
    // through track-click (carrying the real destination as the `url`
    // param) BEFORE rendering, so the sent HTML's button looks and behaves
    // identically to the admin's preview except for where the link actually
    // goes. Building a modified content object rather than post-processing
    // the rendered HTML string keeps this handler and
    // apps/web/.../render-email-template.ts's renderBroadcastEmailHtml
    // producing byte-for-byte identical markup for the same input.
    let renderedContent = emailContent;
    if (!isPartner && emailContent?.buttonUrl) {
      const clickUrl = buildBroadcastClickTrackingUrl(notificationId, emailContent.buttonUrl);
      if (clickUrl) {
        renderedContent = { ...emailContent, buttonUrl: clickUrl };
      }
    }

    let html = renderBroadcastEmailHtml(renderedContent, subject, body);
    if (!isPartner) {
      const unsubUrl = buildBroadcastUnsubscribeUrl(recipientId);
      if (unsubUrl) {
        html += `<p style="color:#5b6b78;font-size:12px;margin-top:16px"><a href="${escapeHtmlForBroadcast(unsubUrl)}" style="color:#5b6b78;text-decoration:underline">Unsubscribe from marketing emails</a></p>`;
      }
      const openUrl = buildBroadcastOpenTrackingUrl(notificationId);
      if (openUrl) {
        html += `<img src="${escapeHtmlForBroadcast(openUrl)}" width="1" height="1" alt="" style="display:none;border:0" />`;
      }
    }

    const plainText = emailContent
      ? `${emailContent.headline}\n\n${emailContent.bodyText}` +
        (emailContent.footerNote ? `\n\n${emailContent.footerNote}` : "") +
        `\n\nTarragon Health`
      : `${subject}\n\n${body}\n\nTarragon Health`;
    return {
      smsText: `${subject}: ${body} Tarragon Health`,
      email: {
        subject,
        html,
        text: plainText,
      },
    };
  },
  // Sent to the patient on the payment_confirmed transition (see
  // enqueue_pharmacy_order_notifications).
  pharmacy_order_patient_confirmation: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const pharmacyName = String(payload.pharmacy_name ?? "the pharmacy");
    const patientName = String(payload.patient_name ?? "there");
    const patientNumber = String(payload.patient_number ?? "");
    const smsText =
      `Hi ${patientName}, your Tarragon Health order ${orderNumber} is confirmed. ` +
      `Show order ${orderNumber} and your patient ID ${patientNumber} at ${pharmacyName} to collect. Tarragon Health`;
    return {
      smsText,
      email: neutralMail(`Your Tarragon Health order ${orderNumber} is confirmed`, [`Hi ${patientName},`, `Your order is confirmed. Show the details below at <strong>${pharmacyName}</strong> to collect it.`], [["Order number", orderNumber], ["Patient ID", patientNumber], ["Pharmacy", pharmacyName]]),
    };
  },
  pharmacy_order_pharmacy_alert: (payload) => {
    const orderNumber = String(payload.order_number ?? "");
    const pharmacyName = String(payload.pharmacy_name ?? "");
    const patientName = String(payload.patient_name ?? "a patient");
    const patientNumber = String(payload.patient_number ?? "");
    const smsText = `New Tarragon Health order ${orderNumber} for ${patientName} (patient ID ${patientNumber}). Open the partner portal for the details. Tarragon Health`;
    return {
      smsText,
      email: neutralMail(`New Tarragon Health order ${orderNumber}`, [`Hello ${pharmacyName},`, "A patient has a confirmed, paid order to collect from you. The details are in the partner portal."], [["Order number", orderNumber], ["Patient", patientName], ["Patient ID", patientNumber]]),
    };
  },
  pharmacy_order_ready_for_collection: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const pharmacyName = String(payload.pharmacy_name ?? "the pharmacy");
    const smsText = `Hi, your Tarragon Health order ${orderNumber} is ready for collection at ${pharmacyName}. Tarragon Health`;
    return {
      smsText,
      email: neutralMail(`Your Tarragon Health order ${orderNumber} is ready for collection`, ["Hi,", `Your order is ready to collect from <strong>${pharmacyName}</strong>.`], [["Order number", orderNumber]]),
      pushUrl: "/patient/medications",
    };
  },
  pharmacy_order_out_for_delivery: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const itemsSummary = String(payload.items_summary ?? "your medication");
    const courierName = String(payload.courier_name ?? "your courier");
    const eta = payload.estimated_delivery_at
      ? new Date(String(payload.estimated_delivery_at)).toLocaleString("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;
    const coldChainNote = payload.requires_cold_chain === true ? " Keep it refrigerated once it arrives." : "";
    const path = "/patient/medications";
    const smsText =
      `Hi, your Tarragon Health order ${orderNumber} is out for delivery with ${courierName}` +
      `${eta ? `, estimated ${eta}` : ""}.${coldChainNote} Tarragon Health`;
    return {
      smsText,
      email: {
        subject: `Your Tarragon Health order ${orderNumber} is out for delivery`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi,</p>` +
          `<p>Your order is on its way with <strong>${courierName}</strong>${eta ? `, estimated ${eta}` : ""}.</p>` +
          `<p style="color:#5b6b78">Order ${orderNumber}</p>` +
          `${coldChainNote ? `<p style="color:#b45309">${coldChainNote.trim()}</p>` : ""}` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
      pushUrl: path,
    };
  },
  pharmacy_order_delivered: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const itemsSummary = String(payload.items_summary ?? "your medication");
    const path = "/patient/medications";
    const smsText = `Hi, your Tarragon Health order ${orderNumber} has been delivered. Tarragon Health`;
    return {
      smsText,
      email: {
        subject: `Your Tarragon Health order ${orderNumber} was delivered`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi,</p>` +
          `<p>Your order has been delivered.</p>` +
          `<p style="color:#5b6b78">Order ${orderNumber}</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
      pushUrl: path,
    };
  },
  pharmacy_order_delivery_failed: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const itemsSummary = String(payload.items_summary ?? "your medication");
    const reasonCopy: Record<string, string> = {
      patient_unavailable: "nobody was available to receive it",
      incorrect_address: "the delivery address needs to be corrected",
      courier_failure: "the courier could not complete the delivery",
      security_access_issue: "the courier could not access the delivery location",
      other: "the delivery could not be completed",
    };
    const reason = reasonCopy[String(payload.failure_reason ?? "other")] ?? reasonCopy.other;
    const path = "/patient/medications";
    const smsText =
      `Hi, delivery of your Tarragon Health order ${orderNumber} did not succeed. ` +
      `We'll be in touch to arrange redelivery. Tarragon Health`;
    return {
      smsText,
      email: {
        subject: `Delivery attempt for your Tarragon Health order ${orderNumber} was unsuccessful`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi,</p>` +
          `<p>We tried to deliver your order but ${reason}. We'll be in touch to arrange redelivery — no action ` +
          `needed from you right now, but you can update your delivery address in the app.</p>` +
          `<p style="color:#5b6b78">Order ${orderNumber}</p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
      pushUrl: path,
    };
  },
  pharmacy_order_unavailable: (payload) => {
    const orderNumber = String(payload.order_number ?? "your order");
    const pharmacyName = String(payload.pharmacy_name ?? "the pharmacy");
    const alternatives = String(payload.alternatives ?? "");
    const altCopy = alternatives ? ` Other pharmacies you could try: ${alternatives}.` : "";
    const smsText = `Hi, ${pharmacyName} could not complete your Tarragon Health order ${orderNumber}.${altCopy} Open the app to see your options. Tarragon Health`;
    return {
      smsText,
      email: neutralMail(`Your Tarragon Health order ${orderNumber} needs your attention`, ["Hi,", `${pharmacyName} could not complete your order. Open the app to see your options.`, ...(alternatives ? [`Other pharmacies you could try: ${alternatives}.`] : [])], [["Order number", orderNumber]]),
      pushUrl: "/patient/medications",
    };
  },
  sponsor_care_reviewed: (payload) => {
    const person = String(payload.person_name ?? "someone you support");
    const smsText =
      `Tarragon Health: a doctor has reviewed something for ${person}. ` +
      `They will discuss what was found with ${person} directly.`;
    return {
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
      `Tarragon Health: ${person} has not opened the app in ${days} days. A call from you often does more than a reminder from us.`;
    return {
      smsText,
      pushUrl: "/patient/supporting",
      email: {
        subject: `${person} has been quiet for ${days} days`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>${person} has not opened the app in ${days} days.</p>` +
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
              `<p style="color:#5b6b78;font-size:13px">Nothing about your account changes. Your records stay between you and your care team, and you can cancel this at any time from your subscription page.</p>`) +
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
          `<p style="color:#5b6b78;font-size:13px">You can see everything you have funded, and what it paid for, under People you support in your dashboard. Their records stay between them and their care team.</p>` +
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
    // CORRECTED 2026-09-05. This builder read `people[]`, `spent_kobo` and
    // `balance_kobo` — a Health-Wallet-era payload shape retired by
    // 20260731215735_retire_health_wallet.sql. The live producer,
    // private.queue_sponsor_monthly_reports(), emits FLAT keys for ONE
    // person: beneficiary_name, ready_count, saving_count, used_this_month
    // and spent_naira. So every sponsor report that has ever been sent said
    // "₦0 became care last month" over an empty table.
    //
    // spent_naira is ALREADY IN NAIRA (the producer divides by 100). The old
    // money() helper divided by 100 again, so simply reconnecting the new key
    // to it would have rendered ₦500 as ₦5. There is no kobo value in this
    // payload at all, and nothing here divides.
    //
    // The in-app copy of this same notification (notification-bell.tsx) was
    // migrated to the flat shape when the producer changed; only this edge
    // function was left behind.
    const naira = (value: unknown) => {
      const amount = Number(value ?? 0);
      return Number.isFinite(amount) ? amount.toLocaleString("en-NG") : "0";
    };
    const name = String(payload.beneficiary_name ?? "someone you support");
    const spent = naira(payload.spent_naira);
    const used = Number(payload.used_this_month ?? 0);
    const ready = Number(payload.ready_count ?? 0);
    const saving = Number(payload.saving_count ?? 0);

    const headline = `₦${spent} became care for ${name} last month`;
    const usedLine =
      used === 1 ? "1 thing you bought was used" : `${used} things you bought were used`;
    const readyLine =
      ready === 1 ? "1 is ready and waiting to be used" : `${ready} are ready and waiting to be used`;
    const savingLine = saving > 0 ? `${saving} more is being saved towards.` : "";

    return {
      smsText: `Tarragon Health: ${headline}. See People you support in your dashboard.`,
      email: {
        subject: `Your monthly summary: ${headline}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Here is what happened last month with the care you are paying for.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:6px 12px 6px 0">Person</td><td style="padding:6px 0"><strong>${name}</strong></td></tr>` +
          `<tr><td style="padding:6px 12px 6px 0">Paid last month</td><td style="padding:6px 0"><strong>&#8358;${spent}</strong></td></tr>` +
          `<tr><td style="padding:6px 12px 6px 0">Used</td><td style="padding:6px 0">${usedLine}</td></tr>` +
          `<tr><td style="padding:6px 12px 6px 0">Ready</td><td style="padding:6px 0">${readyLine}${savingLine ? ` ${savingLine}` : ""}</td></tr>` +
          `</table>` +
          `<p style="color:#5b6b78;font-size:13px">You can see everything you have funded, and what it paid for, under People you support in your dashboard.</p>` +
          `<p style="color:#5b6b78;font-size:13px">This summary covers money and activity only. Their records stay between them and their care team.</p>` +
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
    const labName = String(payload.lab_name ?? "the partner");
    const patientName = String(payload.patient_name ?? "there");
    const patientNumber = String(payload.patient_number ?? "");
    const smsText = `Hi ${patientName}, your Tarragon Health order ${orderNumber} is confirmed at ${labName}. Show order ${orderNumber} and your patient ID ${patientNumber} when you arrive. Tarragon Health`;
    return {
      smsText,
      email: neutralMail(`Your Tarragon Health order ${orderNumber} is confirmed`, [`Hi ${patientName},`, `Your order is confirmed at <strong>${labName}</strong>. Show the details below when you arrive.`], [["Order number", orderNumber], ["Patient ID", patientNumber]]),
    };
  },
  lab_order_lab_alert: (payload) => {
    const orderNumber = String(payload.order_number ?? "");
    const labName = String(payload.lab_name ?? "");
    const patientName = String(payload.patient_name ?? "a patient");
    const patientNumber = String(payload.patient_number ?? "");
    const smsText = `New Tarragon Health order ${orderNumber} for ${patientName} (patient ID ${patientNumber}). Open the partner portal for the details. Tarragon Health`;
    return {
      smsText,
      email: neutralMail(`New Tarragon Health order ${orderNumber}`, [`Hello ${labName},`, "A patient has a confirmed order to be received. The details are in the partner portal."], [["Order number", orderNumber], ["Patient", patientName], ["Patient ID", patientNumber]]),
    };
  },
  referral_patient_confirmation: (payload) => {
    const referralNumber = String(payload.referral_number ?? "your referral");
    const specialistName = String(payload.specialist_name ?? "your specialist");
    const patientName = String(payload.patient_name ?? "there");
    const patientNumber = String(payload.patient_number ?? "");
    const smsText =
      `Hi ${patientName}, your Tarragon Health referral ${referralNumber} to ${specialistName} is confirmed. ` +
      `Your care team will follow up on booking your appointment. Tarragon Health`;
    return {
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
  // transition — no chat-app leg, mirrors pharmacy_order_pharmacy_alert /
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
      `Please expect contact to arrange this patient's appointment. Tarragon Health`;
    return {
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
          `</table>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health: Care that stays with you.</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to a waitlisted patient when their state is switched live
  // (private.notify_region_waitlist). A "now available" nudge only — nothing is
  // auto-booked; they open the app to act. care_recipient is set when they were waiting on behalf
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
      `You can now book the services you asked about in the app. Tarragon Health`;

    return {
      smsText,
      email: {
        subject: `TarragonHealth is now live in ${state}`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${requesterName},</p>` +
          `<p>Great news, TarragonHealth is now live in <strong>${state}</strong>${careRecipient ? ` for ${careRecipient}` : ""}. ` +
          `The services you asked us to tell you about are ready to book:</p>` +
          `<p>Open the Tarragon Health app to book; everything is in one place.</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Reputation & Review-Generation Engine (private.enqueue_reputation_review_prompt).
  // Email-only -- there is no SMS row for this template, so
  // components/smsText below are never actually rendered on those channels,
  // but the TEMPLATE_MAP call signature requires them regardless.
  // The link goes through our own signed click-tracking redirect
  // (/api/reputation/trustpilot-click), reusing the exact same
  // signBroadcastLinkMessage/BROADCAST_LINK_SECRET mechanism the broadcast
  // click-tracking links above already use -- a promptId being an
  // unguessable UUID isn't treated as sufficient on its own in this
  // codebase (see track-click/route.ts's own header comment), so this
  // doesn't invent a weaker exception for one more link type. The caller
  // checks TRUSTPILOT_REVIEW_URL is configured before ever invoking this
  // render function (see the guard right before TEMPLATE_MAP is looked up)
  // -- this function can assume it's present. If BROADCAST_LINK_SECRET isn't
  // configured, signBroadcastLinkMessage returns null -- the tracked
  // redirect route always rejects a missing/invalid token (it fails closed,
  // never accepts an "unsigned" click), so linking to it without a token
  // would just be a permanently broken link for every recipient. Matches
  // the broadcast_announcement template's own established fallback instead
  // (see its `if (clickUrl) { ... }` a few hundred lines up): link straight
  // to the real destination, untracked, rather than through a redirect that
  // can never succeed.
  reputation_review_request_trustpilot: (payload, ctx) => {
    const promptId = String(payload.reputation_review_prompt_id ?? "");
    const token = signBroadcastLinkMessage(`reputation-click:${promptId}`);
    const clickUrl = token
      ? appUrl(`/api/reputation/trustpilot-click?prompt_id=${encodeURIComponent(promptId)}&token=${encodeURIComponent(token)}`)
      : (Deno.env.get("TRUSTPILOT_REVIEW_URL") ?? "");
    const smsText =
      `Thank you for trusting Tarragon Health with your care. If you have a moment, ` +
      `we'd be grateful for a review: ${clickUrl} Tarragon Health`;
    return {
      smsText,
      email: {
        subject: "How has your care been with Tarragon Health?",
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi there,</p>` +
          `<p>Thank you for trusting Tarragon Health with your care. If you have a moment, ` +
          `we'd be really grateful if you shared your experience in a quick review.</p>` +
          `<p style="margin:24px 0"><a href="${clickUrl}" style="background:#0E7C52;color:#fff;padding:10px 20px;` +
          `border-radius:6px;text-decoration:none;display:inline-block">Leave a review</a></p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: smsText,
      },
    };
  },
  // Sent to the patient when a clinician/specialist prescribes a medication
  // (private.enqueue_medication_prescribed_notifications). Email is the
  // guaranteed channel the requirement asks for.
  medication_prescribed_patient: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const smsText = `Hi ${patientName}, your care team added something new for you. Open the Tarragon Health app to see it. Tarragon Health`;
    return {
      smsText,
      email: neutralMail("Your care team added something new for you", [`Hi ${patientName},`, "Your care team added something new for you. Open the Tarragon Health app to see it."]),
    };
  },
  prescription_updated_patient: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const smsText = `Hi ${patientName}, your care team updated a document for you. Open the Tarragon Health app to get the new one: any copy you saved earlier no longer works. Tarragon Health`;
    return {
      smsText,
      email: neutralMail("Your care team updated a document for you", [`Hi ${patientName},`, "Your care team updated a document for you. Open the Tarragon Health app to get the new one. Any copy you saved earlier no longer works."], [["Reference", String(payload.rx_number ?? "")]]),
    };
  },
  // The PDF attached by the sender names the request (OQ-91); the wording here stays neutral.
  lab_order_requested_patient: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const orderNumber = String(payload.order_number ?? "your order");
    const selfBooked = payload.self_booked === true;
    const lead = selfBooked
      ? `Your order is confirmed. A printable PDF is attached: take it with you, or show order ${orderNumber}.`
      : "Your care team has made a request for you. A printable PDF is attached.";
    const smsText = selfBooked
      ? `Hi ${patientName}, your order ${orderNumber} is confirmed. Show it when you arrive. Tarragon Health`
      : `Hi ${patientName}, your care team made a request for you (order ${orderNumber}). See the details in the Tarragon Health app. Tarragon Health`;
    return {
      smsText,
      email: neutralMail(selfBooked ? `Your order ${orderNumber} is confirmed` : "Your care team made a request for you", [`Hi ${patientName},`, lead], [["Order number", orderNumber]]),
    };
  },
  preventive_care_plan_updated: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const smsText = `Hi ${patientName}, your care plan has been updated. See the Tarragon Health app for what is due. Tarragon Health`;
    return {
      smsText,
      email: neutralMail("Your care plan has been updated", [`Hi ${patientName},`, "Your care plan has been updated. A copy is attached as a PDF."]),
    };
  },
  vaccination_verified: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const serial = String(payload.certificate_serial ?? "");
    const smsText = `Hi ${patientName}, your care team has reviewed a document you uploaded. Open the app to see it. Tarragon Health`;
    return {
      smsText,
      email: neutralMail("Your care team has reviewed a document you uploaded", [`Hi ${patientName},`, "Your care team has reviewed a document you uploaded. Open the Tarragon Health app to see it."], [["Reference", serial]]),
    };
  },
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
      smsText,
    };
  },
  // Sent to org clinicians when an abnormal/critical screening result lands
  // (private.handle_abnormal_screening_result -> abnormal-result-handler,
  // via private.enqueue_critical_notification — 2026-07-30). Now a
  // tracked, critical-priority row that starts on push and force-escalates
  // through the channel ladder if nobody confirms it (see
  // critical_notification_engine.sql).
  // Clinician paging (D-12): says only that a priority case waits. The patient and the reason are in the console.
  abnormal_result_clinician_alert: () => ({
    smsText: "New priority case. Open your Tarragon Health worklist. Tarragon Health",
  }),
  emergency_event_clinician_alert: (payload) => {
    const patientName = String(payload.patient_name ?? "A patient");
    const sourceLabel = String(payload.source_label ?? "an emergency");
    return {
      smsText:
        "New priority case. Open your Tarragon Health worklist. Tarragon Health",
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
      smsText:
        "New priority case. Open your Tarragon Health worklist. Tarragon Health",
    };
  },
  // Sent to the patient after the follow-up window on an emergency event
  // (private.notify_emergency_followups). Gentle check-in nudging them to update
  // their care team in the app — the follow-up itself happens in-app, never over
  // SMS.
  emergency_followup: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const smsText =
      `Hi ${patientName}, we noticed you recently reported an emergency. We hope you're okay. ` +
      `When you can, open the Tarragon Health app to let your care team know how you're doing. ` +
      `Tarragon Health`;
    return {
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
  // Health Communication Engine follow-up (2026-08-29): these three hops of
  // the clinician-alert ack-timeout escalation ladder (see
  // clinician_alert_ack_timeout_escalation_ladder.sql /
  // private.notify_clinician_alert) had NO entry here and NO
  // notification_template_locales row either — every non-in_app send
  // (push/sms) was failing with "unknown template" in production
  // (confirmed live: dozens of failed rows, oldest well before this fix).
  // The in_app leg was unaffected (private.notify_clinician_alert always
  // writes that one directly with the real clinical message; it's outside
  // this Edge Function's query entirely). payload.message is always a
  // fully-resolved, pre-built string from the enqueuing PL/pgSQL — never
  // branched here, matching the same shape as every other "payload already
  // did the logic" template in this map.
  clinician_alert_ack_timeout_backup: (payload) => {
    const message = String(payload.message ?? "You have a new urgent alert on Tarragon Health.");
    return {
      smsText: message,
      pushUrl: "/clinician/escalations",
    };
  },
  clinician_alert_ack_timeout_senior: (payload) => {
    const message = String(payload.message ?? "You have a new urgent alert on Tarragon Health.");
    return {
      smsText: message,
      pushUrl: "/clinician/escalations",
    };
  },
  clinician_alert_ack_timeout_admin: (payload) => {
    const message = String(payload.message ?? "You have a new urgent alert on Tarragon Health.");
    return {
      smsText: message,
      pushUrl: "/clinician/escalations",
    };
  },
  // S15: licence and indemnity reminders (3 months, 1 month, the day), grace and suspension notices, and application
  // decisions, from private.credential_notify. payload.subject and payload.message arrive fully resolved; this only
  // frames them. Only in_app and email rows are written for it (SMS is for codes and paging only).
  credential_notice: (payload) => {
    let subject = String(payload.subject ?? "An update about your Tarragon Health clinician account");
    let message = String(payload.message ?? "Open Tarragon Health to see the details.");
    if (typeof payload.i18n_key === "string") {
      const params = typeof payload.i18n_params === "object" && payload.i18n_params !== null
        ? Object.fromEntries(Object.entries(payload.i18n_params as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
        : undefined;
      const resolved = resolveI18n(payload.i18n_key, params);
      if (resolved) { subject = resolved.subject; message = resolved.body; }
    }
    return {
      smsText: message,
      pushUrl: payload.audience === "applicant" ? "/account/clinician" : payload.audience === "rota_review" ? "/rota" : payload.audience === "rota" ? "/clinician/rota" : payload.audience === "lead" ? "/clinician/patients" : "/clinician/credentials",
      email: {
        subject,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hello,</p>` +
          `<p>${escapeHtmlForBroadcast(message)}</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: `Hello,\n\n${message}\n\nTarragon Health`,
      },
    };
  },
  // S29 Care Circle (INV-07): fixed wording, nothing from the payload is echoed, nothing names a condition, reading or result.
  // circle_check_in is the red alert to a supporter who holds red_alerts; the others are notices about the circle itself.
  circle_check_in: () => ({
    smsText: "Someone in your Care Circle may need you. Open Tarragon Health. Tarragon Health",
    pushUrl: "/patient/supporting",
    email: {
      subject: "Please check in with someone you support",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Someone in your Care Circle may need you now.</p>` +
        `<p>Please call them, then open Tarragon Health to see what you can do.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Someone in your Care Circle may need you now.\n\nPlease call them, then open Tarragon Health to see what you can do.\n\nTarragon Health",
    },
  }),
  circle_joined: () => ({
    smsText: "Someone has joined your Care Circle. Tarragon Health",
    pushUrl: "/patient",
    email: {
      subject: "Someone joined your Care Circle",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Someone has joined your Care Circle.</p>` +
        `<p>You can change what they see, or remove them, at any time in Tarragon Health.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Someone has joined your Care Circle.\n\nYou can change what they see, or remove them, at any time in Tarragon Health.\n\nTarragon Health",
    },
  }),
  circle_left: () => ({
    smsText: "Someone has left your Care Circle. Tarragon Health",
    pushUrl: "/patient",
    email: {
      subject: "Someone has left your Care Circle",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Someone has left your Care Circle.</p>` +
        `<p>Open Tarragon Health to see your Care Circle.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Someone has left your Care Circle.\n\nOpen Tarragon Health to see your Care Circle.\n\nTarragon Health",
    },
  }),
  circle_expiring: () => ({
    smsText: "Someone's access to your Care Circle ends soon. Tarragon Health",
    pushUrl: "/patient/care-circle",
    email: {
      subject: "Someone's Care Circle access ends soon",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Someone's access to your Care Circle ends soon.</p>` +
        `<p>Open Tarragon Health if you want to renew it.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Someone's access to your Care Circle ends soon.\n\nOpen Tarragon Health if you want to renew it.\n\nTarragon Health",
    },
  }),
  circle_expiring_soon: () => ({
    smsText: "Someone's access to your Care Circle ends in a few days. Tarragon Health",
    pushUrl: "/patient/care-circle",
    email: {
      subject: "Someone's Care Circle access ends in a few days",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Someone's access to your Care Circle ends in a few days.</p>` +
        `<p>Open Tarragon Health and renew it with one tap if you want them to keep it.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Someone's access to your Care Circle ends in a few days.\n\nOpen Tarragon Health and renew it with one tap if you want them to keep it.\n\nTarragon Health",
    },
  }),
  circle_pause_ended: () => ({
    smsText: "Your pause on sharing has ended. Tarragon Health",
    pushUrl: "/patient/care-circle",
    email: {
      subject: "Your pause on sharing has ended",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Your pause on sharing has ended.</p>` +
        `<p>The people in your Care Circle can see what you chose to share again. You can pause again, or change who sees what, in Tarragon Health.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Your pause on sharing has ended.\n\nThe people in your Care Circle can see what you chose to share again. You can pause again, or change who sees what, in Tarragon Health.\n\nTarragon Health",
    },
  }),
  circle_gift_waiting: () => ({
    smsText: "Someone has paid for care for you. Open Tarragon Health to accept it. Tarragon Health",
    pushUrl: "/patient/care-circle",
    email: {
      subject: "Someone has paid for care for you",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Someone in your Care Circle has paid for care for you.</p>` +
        `<p>Open Tarragon Health to accept it. Nothing starts until you say yes.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Someone in your Care Circle has paid for care for you.\n\nOpen Tarragon Health to accept it. Nothing starts until you say yes.\n\nTarragon Health",
    },
  }),
  circle_paid_for_you: () => ({
    smsText: "Someone has paid for your care. Open Tarragon Health. Tarragon Health",
    pushUrl: "/patient",
    email: {
      subject: "Someone has paid for your care",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>Someone in your Care Circle has paid for your care.</p>` +
        `<p>Open Tarragon Health to see what it includes.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "Someone in your Care Circle has paid for your care.\n\nOpen Tarragon Health to see what it includes.\n\nTarragon Health",
    },
  }),
  // S19: a red event page to the clinician on call (on_call_page) and the alert to the clinical lead and ops when nobody
  // has acknowledged it (on_call_escalation). Sent as push, in-app and email together at critical priority. The wording
  // is fixed and neutral (INV-07): no condition, reading, name or result, and nothing from the payload is echoed.
  on_call_page: () => ({
    smsText: "New priority case. Open your Tarragon Health worklist. Tarragon Health",
    pushUrl: "/clinician/on-call",
    email: {
      subject: "Priority case waiting",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>A priority case needs you now.</p>` +
        `<p>Open Tarragon Health and acknowledge it on the On call page.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "A priority case needs you now.\n\nOpen Tarragon Health and acknowledge it on the On call page.\n\nTarragon Health",
    },
  }),
  on_call_escalation: () => ({
    smsText: "A priority case has not been picked up. Open Tarragon Health. Tarragon Health",
    pushUrl: "/rota",
    email: {
      subject: "A priority case has not been picked up",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>A priority case has not been acknowledged by the clinicians on call.</p>` +
        `<p>Open Tarragon Health to see where it stands.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "A priority case has not been acknowledged by the clinicians on call.\n\nOpen Tarragon Health to see where it stands.\n\nTarragon Health",
    },
  }),
  on_call_unfinished: () => ({
    smsText: "A priority case was acknowledged but is not closed yet. Open Tarragon Health. Tarragon Health",
    pushUrl: "/rota",
    email: {
      subject: "A priority case is still open",
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
        `<p>A priority case was acknowledged but has not been closed yet.</p>` +
        `<p>Open Tarragon Health to see where it stands.</p>` +
        `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
        `</div>`,
      text: "A priority case was acknowledged but has not been closed yet.\n\nOpen Tarragon Health to see where it stands.\n\nTarragon Health",
    },
  }),
  // S18: the patient is told when their care team lead is set, changes, or is still being arranged. Fixed wording by
  // kind, no names and nothing clinical (INV-07). No name is promised or shown: the care team card names nobody ahead
  // of a real review (OQ-129). "Your care team", never "your doctor". Only in_app and email rows are written for it.
  care_team_notice: (payload) => {
    const kind = String(payload.kind ?? "");
    const message =
      kind === "changed"
        ? "Your care team lead has changed. Your care team is still looking after you."
        : kind === "arranging"
          ? "We are arranging your care team lead. We will tell you here as soon as they are in place."
          : "Your care team now has a lead clinician for you. Your care team is looking after you.";
    return {
      smsText: message,
      pushUrl: "/patient",
      email: {
        subject: "An update about your care team",
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hello,</p>` +
          `<p>${escapeHtmlForBroadcast(message)}</p>` +
          `<p style="color:#0E7C52"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: `Hello,\n\n${message}\n\nTarragon Health`,
      },
    };
  },
  // Same gap as the three ack-timeout keys above, found in the same pass:
  // no TEMPLATE_MAP entry existed anywhere for this key even though
  // lab_result_documents.sql (see enqueue_lab_result_document_notifications,
  // most recently redefined in guarantee_in_app_notification_companions.sql)
  // enqueues it on email+in_app whenever a lab liaison/clinician/
  // admin uploads a result document on the patient's behalf. Confirmed via
  // production query: zero notifications rows have ever used this template,
  // so unlike the ack-timeout fix this is a latent gap, not an active
  // failure -- fixed now anyway rather than left to fail the first time the
  // path is actually exercised. payload only carries `source` (who
  // uploaded it); the in-app rendering in notification-bell.tsx already
  // ignores it too, so this stays a plain static message rather than
  // inventing branching the original design never called for.
  result_document_available: () => {
    const smsText = "Hi, something new is waiting in your record. Open the Tarragon Health app to see it. Tarragon Health";
    return {
      smsText,
      pushUrl: "/patient/labs",
      email: neutralMail("Something new is waiting in your Tarragon Health app", ["Something new is waiting in your record. Open the app to see it."]),
    };
  },
  appointment_booking_confirmation: (payload) => {
    const when = formatLagosDateTime(payload.scheduled_for);
    const type = APPOINTMENT_TYPE_LABEL[String(payload.appointment_type ?? "")] ?? "appointment";
    const smsText = `Your Tarragon Health ${type} is booked for ${when}. Open the app for details. Tarragon Health`;
    return {
      smsText,
      pushUrl: "/patient/care",
    };
  },
  appointment_cancelled: (payload) => {
    const when = formatLagosDateTime(payload.scheduled_for);
    const byPatient = payload.cancelled_by_patient === true;
    const credit = payload.credit_returned === true ? " Your consultation credit is back in the app." : "";
    const smsText = byPatient
      ? `Your Tarragon Health appointment for ${when} has been cancelled, as requested.${credit} Book another any time in the app. Tarragon Health`
      : `Your Tarragon Health appointment for ${when} has been cancelled.${credit} Open the app to rebook. Tarragon Health`;
    return {
      smsText,
      pushUrl: "/patient/care",
    };
  },
  // S21: neutral by design (INV-07). Nothing here names a reason, a condition or a clinician; the details live in the app.
  video_call_requested: (payload) => ({
    smsText: "Your care team would like a quick call. Open the app to join. Tarragon Health",
    pushUrl: `/patient/video-visit/${String(payload.consultation_id ?? "")}`,
  }),
  consult_join_ready: (payload) => ({
    smsText: "Your consultation room is open. Open the app to join. Tarragon Health",
    pushUrl: `/patient/consultation/${String(payload.encounter_id ?? "")}`,
  }),
  consult_missed: (payload) => ({
    smsText:
      payload.credit_returned === true
        ? "Your consultation did not go ahead. Your credit is back in the app and you can rebook for free. Tarragon Health"
        : "Your consultation did not go ahead. Open the app to rebook. Tarragon Health",
    pushUrl: "/patient/care",
  }),
  appointment_provider_cancelled: (payload) => {
    const when = formatLagosDateTime(payload.scheduled_for);
    const type = APPOINTMENT_TYPE_LABEL[String(payload.appointment_type ?? "")] ?? "appointment";
    const smsText =
      `Your Tarragon Health ${type} for ${when} has been cancelled by your provider. Open the app to rebook. Tarragon Health`;
    return {
      smsText,
      pushUrl: "/patient/care",
    };
  },
  appointment_reminder: (payload) => {
    const when = formatLagosDateTime(payload.scheduled_for);
    const type = APPOINTMENT_TYPE_LABEL[String(payload.appointment_type ?? "")] ?? "appointment";
    const milestone = String(payload.milestone ?? "");
    const lead = milestone === "shortly_before" ? "starting shortly" : `coming up (${when})`;
    const smsText =
      milestone === "shortly_before"
        ? `Reminder: your Tarragon Health ${type} is starting shortly. Open the app for details. Tarragon Health`
        : `Reminder: your Tarragon Health ${type} is ${lead}. Open the app for details. Tarragon Health`;
    return {
      smsText,
      pushUrl: "/patient/care",
    };
  },
  appointment_rescheduled: (payload) => {
    const when = formatLagosDateTime(payload.scheduled_for);
    const smsText = `Your Tarragon Health appointment has been rescheduled to ${when}. Open the app for details. Tarragon Health`;
    return {
      smsText,
      pushUrl: "/patient/care",
    };
  },
  appointment_waiting_list_offer: (payload) => {
    const when = formatLagosDateTime(payload.scheduled_for);
    const minutes = String(payload.offer_expires_minutes ?? "30");
    const smsText =
      `A waiting-list slot opened up for ${when}. Claim it in the Tarragon Health app within ${minutes} minutes ` +
      `or it goes to the next person. Tarragon Health`;
    return {
      smsText,
      pushUrl: "/patient/care",
    };
  },
  // Escalating preventive reminders (escalating_preventive_reminders.sql,
  // 2026-08-27) is the "_due" reminder ladder's overdue/escalated/upcoming
  // stages -- screening_due/vaccination_due (above) already had
  // TEMPLATE_MAP entries, but these three sibling stages per pathway never
  // did, despite being enqueued by the same migration's triggers. Shares
  // screening_due/vaccination_due's exact payload shape.
  screening_upcoming: (payload) => {
    const screenTypeName = String(payload.screen_type_name ?? "a screening");
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a reminder is coming up on ${dueDate}. Open the Tarragon Health app to book it. Tarragon Health`,
      pushUrl: "/patient/prevention",
    };
  },
  screening_overdue: (payload) => {
    const screenTypeName = String(payload.screen_type_name ?? "a screening");
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a reminder from ${dueDate} is still waiting. Open the Tarragon Health app to book it. Tarragon Health`,
      pushUrl: "/patient/prevention",
    };
  },
  screening_escalated: (payload) => {
    const screenTypeName = String(payload.screen_type_name ?? "a screening");
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a reminder from ${dueDate} is still waiting. Please book it soon, or your care team may follow up. Tarragon Health`,
      pushUrl: "/patient/prevention",
    };
  },
  vaccination_upcoming: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a reminder is coming up on ${dueDate}. Open the Tarragon Health app to book or log it. Tarragon Health`,
      pushUrl: "/patient/prevention",
    };
  },
  vaccination_overdue: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a reminder from ${dueDate} is still waiting. Open the Tarragon Health app to book or log it. Tarragon Health`,
      pushUrl: "/patient/prevention",
    };
  },
  vaccination_escalated: (payload) => {
    const dueDate = String(payload.due_date ?? "soon");
    return {
      smsText: `Hi, a reminder from ${dueDate} is still waiting. Please open the app soon, or your care team may get in touch. Tarragon Health`,
      pushUrl: "/patient/prevention",
    };
  },
  lifestyle_checkin_due: (payload) => {
    const title = String(payload.title ?? "your lifestyle programme");
    return {
      smsText: "Hi, time for today's check-in. Open the Tarragon Health app to log it. Tarragon Health",
      pushUrl: "/patient/lifestyle",
    };
  },
  // Same "registered, enqueued for real, never rendered" gap as the blocks
  // above -- confirmed live 2026-09-15: 140 failed rows across these four
  // keys, every one `last_error = 'unknown template'`, oldest from
  // 2026-08-29 (the day each producer migration shipped). No TEMPLATE_MAP
  // entry and no notification_template_locales row existed for any of
  // them, so the DB-driven fallback (17.5) never had anything to catch
  // this either.
  //
  // record_login_device() (known_device_login_notification.sql) queues this
  // in_app + email, priority='critical' -- payload.message is a
  // fully-resolved string already, same shape as the ack-timeout ladder
  // above, so this stays a plain pass-through. Never gated by
  // TEMPLATE_CATEGORY, matching every other critical-only security/safety
  // template in this map.
  "security.new_device_signin": (payload) => {
    const message = String(
      payload.message ?? "New sign-in to your Tarragon Health account from a device we haven't seen before.",
    );
    return {
      smsText: message,
      pushUrl: "/patient/settings/security",
      email: {
        subject: "New sign-in to your Tarragon Health account",
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>${message}</p>` +
          `<p style="color:#5b6b78;font-size:13px">If this was you, there's nothing else to do. If it wasn't, change your password right away and reach out to your care team from the app.</p>` +
          `<p style="color:#5b6b78;font-size:13px">&mdash; Tarragon Health</p>` +
          `</div>`,
        text: message,
      },
    };
  },
  // private.queue_medication_dose_reminders() (medication_dose_time_
  // reminders.sql) queues this in_app (+ push) every 15 minutes at a
  // medication's scheduled dose time. scheduled_time is already an
  // Africa/Lagos local HH:MM string from the producer, not a timestamp --
  // no formatLagosDateTime conversion needed or correct here.
  // S08 (INV-07): no medicine name in the wording, and the producer no longer sends one.
  medication_dose_reminder: (payload) => {
    const scheduledTime = String(payload.scheduled_time ?? "now");
    return {
      smsText: `Hi, it's ${scheduledTime}: time for your care plan check. Open the Tarragon Health app to see what is due. Tarragon Health`,
      pushUrl: "/patient/medications",
    };
  },
  // private.check_vitals_monitoring_adherence() (vitals_monitoring_
  // adherence_and_gap_ladder.sql) queues these three in_app (+ push) as a
  // patient falls further behind their prescribed monitoring schedule for
  // one vital. vital_type is the raw enum (e.g. 'blood_pressure'); the SQL
  // producer's own label formatting (replace '_' with a space, used only
  // through lower()) is mirrored here for the same reason it's mirrored
  // there -- these three copies need to read as one continuing message as
  // a patient moves through the ladder, not as independently-worded alerts.
  vitals_monitoring_due: () => ({
    smsText: "Hi, it's time for your check-in. Open the Tarragon Health app to log it. Tarragon Health",
    pushUrl: "/patient/vitals",
  }),
  vitals_monitoring_overdue: () => ({
    smsText: "Hi, it has been a few days since your last check-in. Please log one when you can. Tarragon Health",
    pushUrl: "/patient/vitals",
  }),
  vitals_monitoring_escalated: () => ({
    smsText: "Hi, your check-in has been waiting for a while and your care team has been notified. Please log one as soon as you can. Tarragon Health",
    pushUrl: "/patient/vitals",
  }),
};
