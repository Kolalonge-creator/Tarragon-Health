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
        from: "TarragonHlth",
        sms: text,
        type: "plain",
        channel: "generic",
      }),
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
    .in("channel", ["whatsapp", "sms"])
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

    const phone = row.template ? phoneById.get(row.recipient_id) : undefined;
    const renderFn = row.template ? TEMPLATE_MAP[row.template] : undefined;

    if (!renderFn) {
      await markFailed("unknown template");
      failed++;
      continue;
    }
    if (!phone) {
      await markFailed("recipient has no phone number on file");
      failed++;
      continue;
    }

    const render = renderFn(row.payload ?? {});

    let result: SendResult;
    if (row.channel === "whatsapp") {
      result = await sendWhatsApp(phone, render);
      if (!result.ok) {
        // WhatsApp delivery failed — fall back to Termii SMS (§8).
        result = await sendTermiiSms(phone, render.smsText);
      }
    } else {
      result = await sendTermiiSms(phone, render.smsText);
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
