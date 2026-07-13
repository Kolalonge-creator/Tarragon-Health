// Tarragon Health — clinician support-inbox reply
// (docs/CLINICAL_TRUST_MODEL_SPEC.md §2/§4, docs/ARCHITECTURE.md §8)
//
// The only way an outbound WhatsApp reply gets sent in this platform.
// Called directly from the clinician's browser session (supabase.functions.
// invoke), unlike whatsapp-webhook/abnormal-result-handler/send-pending-
// notifications which are all triggered server-side. verify_jwt stays at
// its platform default (true) — Supabase's gateway rejects the call before
// it reaches this code unless the caller presents a valid session, and this
// function additionally checks that caller is org staff (not a patient) for
// the target patient's own organisation before doing anything.
//
// Signs every message with the real sending clinician's name from
// clinical_staff — never a hardcoded "Tarragon" string — per the
// engineering rule in CLINICAL_TRUST_MODEL_SPEC.md §2. Mirrors the other
// functions' send-result handling: never throws, always responds 200,
// records the outcome rather than requiring the WhatsApp send to succeed
// (CLAUDE.md: "the platform must keep working if [external service] is
// down" / "no feature may be built to depend on a WhatsApp send
// succeeding").

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fn(controller.signal);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Free-form text send, not a template send — WhatsApp Cloud API allows this
 * only within the 24h customer-service window after an inbound message,
 * which is exactly the "reply to a patient who messaged support" case this
 * function exists for (contrast sendWhatsAppTemplate in
 * abnormal-result-handler, used for provider-initiated alerts outside that
 * window).
 */
async function sendWhatsAppText(toPhone: string, text: string): Promise<SendResult> {
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
        type: "text",
        text: { body: text },
      }),
    }),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const jsonResponse = (body: Record<string, unknown>) =>
    Response.json(body, { headers: CORS_HEADERS });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ ok: false, error: "Not signed in" });
  }

  const supabaseAsCaller = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const {
    data: { user },
  } = await supabaseAsCaller.auth.getUser();
  if (!user) {
    return jsonResponse({ ok: false, error: "Not signed in" });
  }

  let body: { patientId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" });
  }
  const patientId = body.patientId;
  const message = body.message?.trim();
  if (!patientId || !message) {
    return jsonResponse({ ok: false, error: "patientId and message are required" });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: callerProfile } = await supabaseAdmin
    .from("profiles")
    .select("organisation_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (!callerProfile || callerProfile.role === "patient" || !callerProfile.organisation_id) {
    return jsonResponse({ ok: false, error: "Not authorized to send support replies" });
  }

  const { data: patient } = await supabaseAdmin
    .from("profiles")
    .select("organisation_id, phone")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient || patient.organisation_id !== callerProfile.organisation_id) {
    return jsonResponse({ ok: false, error: "Patient not found in your organisation" });
  }
  if (!patient.phone) {
    return jsonResponse({ ok: false, error: "Patient has no phone number on file" });
  }

  // The real signature — never a hardcoded string (CLINICAL_TRUST_MODEL_SPEC.md §2).
  const { data: staff } = await supabaseAdmin
    .from("clinical_staff")
    .select("full_name")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  const signature = staff ? `— ${staff.full_name}, Tarragon Care Team` : "— Tarragon Care Team";
  const fullBody = `${message}\n\n${signature}`;

  const sendResult = await sendWhatsAppText(patient.phone, fullBody);

  const { error: insertError } = await supabaseAdmin.from("support_messages").insert({
    organisation_id: callerProfile.organisation_id,
    patient_id: patientId,
    sender_id: user.id,
    direction: "outbound",
    from_phone: Deno.env.get("WHATSAPP_PHONE_ID") ?? "tarragon",
    to_phone: patient.phone,
    message_type: "text",
    body: fullBody,
    raw_payload: { send_result: sendResult },
  });

  // Mark the patient's open inbound thread as replied — best-effort, never
  // blocks the response on this housekeeping update.
  await supabaseAdmin
    .from("support_messages")
    .update({ status: "replied" })
    .eq("patient_id", patientId)
    .eq("direction", "inbound")
    .neq("status", "replied");

  return jsonResponse({
    ok: sendResult.ok,
    stored: !insertError,
    error: sendResult.ok ? undefined : sendResult.error,
  });
});
