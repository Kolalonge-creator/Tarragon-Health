// Tarragon Health — Zoom webhook (video_consultations)
//
// Mirrors supabase/functions/paystack-webhook/index.ts's shape: signature-
// verified, never throws past its boundary, always returns 200 (Zoom
// retries on non-2xx), and every event is recorded to
// zoom_webhook_events — including ones it fails to process — so nothing is
// ever silently dropped. The Deno copy of the signature algorithm here
// must match apps/web/src/lib/zoom/webhook-signature.ts's reference
// implementation exactly (can't share code across the Next.js/Deno
// runtime boundary, same reason paystack-webhook duplicates its own copy).
//
// Zoom also requires answering its endpoint.url_validation challenge to
// activate a webhook subscription in the first place — this has no
// Paystack/Stripe precedent in this repo, since neither of those providers
// has an equivalent handshake step.

import { createClient } from "jsr:@supabase/supabase-js@2";

interface ZoomWebhookEvent {
  event: string;
  payload: {
    plainToken?: string;
    object?: {
      id?: number | string;
      uuid?: string;
    };
  };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = Deno.env.get("ZOOM_WEBHOOK_SECRET_TOKEN");
  // Fail closed, same posture as paystack-webhook: a forged event here
  // could mark a real consultation started/ended, not just a fake chat
  // message, so an unconfigured secret must reject every request.
  if (!secret) {
    console.error("zoom-webhook: ZOOM_WEBHOOK_SECRET_TOKEN is not set — rejecting all events");
    return false;
  }
  if (!timestampHeader || !signatureHeader) return false;

  const expected = `v0=${await hmacHex(secret, `v0:${timestampHeader}:${rawBody}`)}`;
  return signatureHeader === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();

  let event: ZoomWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 200 });
  }

  // Zoom's one-time handshake to activate the webhook subscription: echo
  // back an HMAC of the plainToken it sends, unsigned (there's nothing to
  // verify yet — the secret itself is what proves we're the real endpoint).
  if (event.event === "endpoint.url_validation") {
    const secret = Deno.env.get("ZOOM_WEBHOOK_SECRET_TOKEN");
    const plainToken = event.payload?.plainToken;
    if (!secret || !plainToken) {
      return Response.json({ ok: false, error: "not_configured" }, { status: 200 });
    }
    const encryptedToken = await hmacHex(secret, plainToken);
    return Response.json({ plainToken, encryptedToken });
  }

  const signatureValid = await verifySignature(
    rawBody,
    req.headers.get("x-zm-request-timestamp"),
    req.headers.get("x-zm-signature"),
  );
  if (!signatureValid) {
    return Response.json({ ok: false, error: "invalid_signature" }, { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const zoomMeetingId = event.payload?.object?.id !== undefined ? String(event.payload.object.id) : null;
  const providerEventId = `${event.event}:${event.payload?.object?.uuid ?? zoomMeetingId ?? rawBody.length}`;

  // Idempotency: a replayed webhook is a guaranteed no-op — the unique
  // constraint on provider_event_id makes this insert fail silently via
  // on_conflict, and no row means "already handled, stop here."
  const { data: eventRow, error: insertError } = await supabase
    .from("zoom_webhook_events")
    .insert({
      provider_event_id: providerEventId,
      event_type: event.event,
      raw_payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle();

  if (insertError && insertError.code !== "23505") {
    console.error("zoom-webhook: failed to record event", insertError);
    return Response.json({ ok: false, error: "record_failed" }, { status: 200 });
  }
  if (!eventRow) {
    return Response.json({ ok: true, replay: true });
  }

  const markProcessed = (videoConsultationId?: string) =>
    supabase
      .from("zoom_webhook_events")
      .update({ processed_at: new Date().toISOString(), video_consultation_id: videoConsultationId ?? null })
      .eq("id", eventRow.id);
  const markFailed = (error: string) =>
    supabase.from("zoom_webhook_events").update({ error }).eq("id", eventRow.id);

  if (!zoomMeetingId) {
    await markFailed(`${event.event} missing payload.object.id`);
    return Response.json({ ok: true });
  }

  try {
    switch (event.event) {
      case "meeting.started": {
        const { data: consultation } = await supabase
          .from("video_consultations")
          .select("id")
          .eq("zoom_meeting_id", zoomMeetingId)
          .maybeSingle();
        if (!consultation) {
          await markFailed(`no video_consultations row with zoom_meeting_id=${zoomMeetingId}`);
          break;
        }
        await supabase
          .from("video_consultations")
          .update({ status: "started", started_at: new Date().toISOString() })
          .eq("id", consultation.id);
        await markProcessed(consultation.id);
        break;
      }

      case "meeting.ended": {
        const { data: consultation } = await supabase
          .from("video_consultations")
          .select("id")
          .eq("zoom_meeting_id", zoomMeetingId)
          .maybeSingle();
        if (!consultation) {
          await markFailed(`no video_consultations row with zoom_meeting_id=${zoomMeetingId}`);
          break;
        }
        await supabase
          .from("video_consultations")
          .update({ status: "completed", ended_at: new Date().toISOString() })
          .eq("id", consultation.id);
        await markProcessed(consultation.id);
        break;
      }

      default:
        // Every other event type is still recorded above for audit but
        // requires no state change.
        await markProcessed();
        break;
    }
  } catch (error) {
    console.error("zoom-webhook: unhandled processing error", error);
    await markFailed(error instanceof Error ? error.message : "unknown processing error");
  }

  return Response.json({ ok: true });
});
