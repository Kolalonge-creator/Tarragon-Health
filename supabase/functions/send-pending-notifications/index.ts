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
