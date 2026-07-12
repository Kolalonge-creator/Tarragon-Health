// Tarragon Health — WhatsApp webhook (docs/ARCHITECTURE.md §1.3, §8)
//
// This function does two things only:
//   1. GET  — answers Meta's hub.challenge handshake when the Callback URL
//      is registered/verified in the app dashboard (Step 2. Production
//      setup > Configure Webhooks).
//   2. POST — receives inbound WhatsApp messages and delivery-status
//      callbacks and stores them. That is the entire scope. Per §8: "no
//      intent router, no bot, no parsing into a vitals/medication_logs/
//      booking write. A clinician reads it like a helpdesk ticket and
//      replies from the platform." Never add automation here — inbound
//      WhatsApp is a human-routed support channel, not a transactional
//      interface (see CLAUDE.md "What Claude Must Never Do").
//
// Mirrors abnormal-result-handler/index.ts and send-pending-notifications/
// index.ts: never throws past its boundary, always responds 200 so Meta
// doesn't retry-storm a transient failure, and every outcome is recorded to
// audit_log rather than silently dropped.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Same fixed direct-consumer org used by private.handle_new_user() for
// self-serve signups with no organisation_id — an inbound message from a
// phone number that doesn't match any known patient still gets stored (for
// triage) rather than dropped, and needs *some* organisation_id per the
// every-table-has-one RLS invariant.
const DEFAULT_CONSUMER_ORG_ID = "00000000-0000-0000-0000-000000000001";

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppStatus {
  id: string;
  status: string;
  recipient_id: string;
}

interface WebhookValue {
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
  metadata?: { display_phone_number?: string };
}

/** Verifies Meta's X-Hub-Signature-256 header against the raw body, when WHATSAPP_APP_SECRET is configured. */
async function isValidSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret) return true; // degrade gracefully — see audit_log warning below
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatureHeader.slice("sha256=".length) === expected;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const auditEvent = (action: string, event: Record<string, unknown>) =>
    supabase.from("audit_log").insert({
      organisation_id: DEFAULT_CONSUMER_ORG_ID,
      actor_id: null,
      action,
      entity_type: "support_messages",
      entity_id: null,
      event,
    });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (mode === "subscribe" && challenge && verifyToken && token === verifyToken) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();

  if (!(await isValidSignature(rawBody, req.headers.get("x-hub-signature-256")))) {
    await auditEvent("whatsapp_webhook.invalid_signature", {});
    return Response.json({ ok: false }, { status: 200 });
  }
  if (!Deno.env.get("WHATSAPP_APP_SECRET")) {
    await auditEvent("whatsapp_webhook.signature_check_skipped", {
      reason: "WHATSAPP_APP_SECRET not configured",
    });
  }

  let body: { entry?: Array<{ changes?: Array<{ value?: WebhookValue }> }> };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 200 });
  }

  const values: WebhookValue[] =
    body.entry?.flatMap((entry) => entry.changes?.map((change) => change.value).filter((v): v is WebhookValue => !!v) ?? []) ?? [];

  let messagesStored = 0;
  let statusesReceived = 0;

  for (const value of values) {
    const businessPhone = value.metadata?.display_phone_number ?? null;

    for (const msg of value.messages ?? []) {
      const fromPhone = msg.from.startsWith("+") ? msg.from : `+${msg.from}`;

      const { data: patient } = await supabase
        .from("profiles")
        .select("id, organisation_id")
        .eq("phone", fromPhone)
        .maybeSingle()
        .returns<{ id: string; organisation_id: string | null } | null>();

      const { error } = await supabase.from("support_messages").upsert(
        {
          organisation_id: patient?.organisation_id ?? DEFAULT_CONSUMER_ORG_ID,
          patient_id: patient?.id ?? null,
          direction: "inbound",
          from_phone: fromPhone,
          to_phone: businessPhone,
          message_type: msg.type,
          body: msg.type === "text" ? msg.text?.body ?? null : null,
          wa_message_id: msg.id,
          raw_payload: msg,
        },
        { onConflict: "wa_message_id", ignoreDuplicates: true },
      );
      if (!error) messagesStored++;
    }

    statusesReceived += value.statuses?.length ?? 0;
  }

  if (messagesStored > 0 || statusesReceived > 0) {
    await auditEvent("whatsapp_webhook.received", { messagesStored, statusesReceived });
  }

  return Response.json({ ok: true, messagesStored, statusesReceived });
});
