// Tarragon Health — notification send layer (Phase 1)
//
// Consumes `notifications` rows queued by the Sprint 2/3 reminder cron jobs
// (queue_vitals_reminders, queue_medication_refill_reminders,
// queue_booking_reminders). Invoked every
// 5 minutes by pg_cron + pg_net (see the schedule_notification_sender
// migration) — not the abnormal-result path, which needs its own
// trigger-invoked, 60-second-SLA handler (docs/ARCHITECTURE.md §7).
//
// Mirrors packages/shared/src/ml-client.ts: every external call has a
// timeout and never throws past its boundary. Missing credentials degrade
// each affected row to `failed` with a clear `last_error`, never a crash
// and never a silently-stuck `pending` row forever.

import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;
const EXTERNAL_TIMEOUT_MS = 5_000;

interface NotificationRow {
  id: string;
  recipient_id: string;
  channel: "whatsapp" | "sms" | "in_app" | "email" | "push";
  template: string | null;
  payload: Record<string, unknown>;
  attempts: number;
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
    return {
      metaTemplateName: "vitals_reminder",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: dueDate }] },
      ],
      smsText:
        `Hi, it's time to log your vitals (due ${dueDate}). ` +
        `Reply on WhatsApp or open the app. — Tarragon Health`,
    };
  },
  medication_refill_reminder: (payload) => {
    const drugName = String(payload.drug_name ?? "your medication");
    const refillDate = String(payload.refill_date ?? "soon");
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
        `Reply on WhatsApp or open the app. — Tarragon Health`,
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
        `Reply on WhatsApp or open the app. — Tarragon Health`,
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
      smsText: `${prompt} Open the Tarragon Health app to answer. — Tarragon Health`,
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
        `Hi, your medication review is due ${dueDate}. Your care team will be in touch — ` +
        `open the app to see details. — Tarragon Health`,
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
        `log it. — Tarragon Health`,
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
        `Hi, your preventive health review is due ${dueDate}. Your care team will be in touch — ` +
        `open the app to see details. — Tarragon Health`,
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
      smsText: `${subject}: ${body} — Tarragon Health`,
      email: {
        subject,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<h2 style="color:#0E7C52;margin:0 0 12px">${escapeHtml(subject)}</h2>` +
          `<p>${bodyHtml}</p>` +
          `<p style="color:#0E7C52;margin-top:20px"><strong>Care that stays with you.</strong></p>` +
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health</p>` +
          `</div>`,
        text: `${subject}\n\n${body}\n\n— Tarragon Health`,
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
      `— Tarragon Health`;
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
      `New Tarragon Health order ${orderNumber}: ${patientName} (patient ID ${patientNumber}) — ` +
      `${itemsSummary}. Please prepare for collection. — Tarragon Health`;
    return {
      metaTemplateName: "pharmacy_order_pharmacy_alert",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: orderNumber }] },
      ],
      smsText,
      email: {
        subject: `New Tarragon Health order ${orderNumber} — ${patientName}`,
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
          `<p style="color:#5b6b78;font-size:13px">Tarragon Health — Care that stays with you.</p>` +
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
      `Good news ${requesterName} — TarragonHealth is now live in ${state}${forWhom}. ` +
      `You can now book ${servicesPretty} in the app. — Tarragon Health`;

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
          `<p>Great news — TarragonHealth is now live in <strong>${state}</strong>${careRecipient ? ` for ${careRecipient}` : ""}. ` +
          `The services you asked us to tell you about are ready to book:</p>` +
          `<p style="margin:16px 0"><strong>${servicesPretty}</strong></p>` +
          `<p>Open the Tarragon Health app to book — everything is in one place.</p>` +
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
      `See the full details in the Tarragon Health app. — Tarragon Health`;
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
  // Sent to the patient when the system or a doctor generates a lab test order
  // for them (private.enqueue_lab_order_requested_notifications). Email is the
  // guaranteed channel; WhatsApp falls back to SMS until the Meta template lands.
  lab_order_requested_patient: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const orderNumber = String(payload.order_number ?? "your order");
    const testName = String(payload.test_name ?? "a lab test");
    const smsText =
      `Hi ${patientName}, a lab test has been requested for you: ${testName} ` +
      `(order ${orderNumber}). See the details in the Tarragon Health app. — Tarragon Health`;
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
        subject: `A lab test has been requested for you`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#12324B;line-height:1.5">` +
          `<p>Hi ${patientName},</p>` +
          `<p>Your care team has requested a lab test for you. Here are the details:</p>` +
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
      `(certificate ${serial}). Download it in the app.${nextLine} — Tarragon Health`;
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
        subject: `Your ${vaccineName} is verified — Tarragon certificate ${serial}`,
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
      `cannot and it is an emergency, help them get to the nearest hospital. — Tarragon Health`;
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
  // Sent to the patient after the follow-up window on an emergency event
  // (private.notify_emergency_followups). Gentle check-in nudging them to update
  // their care team in the app — the follow-up itself happens in-app, never over
  // WhatsApp/SMS.
  emergency_followup: (payload) => {
    const patientName = String(payload.patient_name ?? "there");
    const smsText =
      `Hi ${patientName}, we noticed you recently reported an emergency. We hope you're okay. ` +
      `When you can, open the Tarragon Health app to let your care team know how you're doing. ` +
      `— Tarragon Health`;
    return {
      metaTemplateName: "emergency_followup",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: patientName }] },
      ],
      smsText,
    };
  },
};

interface SendResult {
  ok: boolean;
  error?: string;
}

/** Never throws — resolves { ok: false } on timeout, network error, or non-2xx. */
async function withExternalCall(
  fn: (signal: AbortSignal) => Promise<Response>,
): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
  try {
    const res = await fn(controller.signal);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
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

  return withExternalCall((signal) =>
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
    .select("id, recipient_id, channel, template, payload, attempts")
    .eq("status", "pending")
    .in("channel", ["whatsapp", "sms", "email"])
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

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    const markSent = () =>
      supabase
        .from("notifications")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);

    const markFailed = (lastError: string) =>
      supabase
        .from("notifications")
        .update({ status: "failed", attempts: row.attempts + 1, last_error: lastError })
        .eq("id", row.id);

    const markRetry = (lastError: string) =>
      supabase
        .from("notifications")
        .update({ attempts: row.attempts + 1, last_error: lastError })
        .eq("id", row.id);

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

    let result: SendResult;
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
      result = await sendEmail(
        toEmail,
        render.email.subject,
        render.email.html,
        render.email.text,
      );
    } else if (row.channel === "whatsapp") {
      if (!toPhone) {
        await markFailed("recipient has no phone number on file");
        failed++;
        continue;
      }
      result = await sendWhatsApp(toPhone, render);
      if (!result.ok) {
        // WhatsApp delivery failed — fall back to Termii SMS (§8).
        result = await sendTermiiSms(toPhone, render.smsText);
      }
    } else {
      if (!toPhone) {
        await markFailed("recipient has no phone number on file");
        failed++;
        continue;
      }
      result = await sendTermiiSms(toPhone, render.smsText);
    }

    if (result.ok) {
      await markSent();
      sent++;
    } else if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await markFailed(result.error ?? "unknown error");
      failed++;
    } else {
      await markRetry(result.error ?? "unknown error");
      retried++;
    }
  }

  return Response.json({ processed: rows.length, sent, retried, failed });
});
