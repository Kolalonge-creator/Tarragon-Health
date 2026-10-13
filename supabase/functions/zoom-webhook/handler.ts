// Tarragon Health — Zoom webhook logic (video_consultations). Split out of index.ts in S14x so it can be tested; index.ts is wiring only.
//
// Mirrors supabase/functions/paystack-webhook's shape: signature-verified, never throws past its boundary, always returns 200 (Zoom
// retries on non-2xx), and every event is recorded — including ones it fails to process — so nothing is silently dropped. The Deno copy
// of the signature algorithm here must match apps/web/src/lib/zoom/webhook-signature.ts's reference implementation exactly (can't share
// code across the Next.js/Deno runtime boundary, same reason paystack-webhook duplicates its own copy).
//
// Zoom also requires answering its endpoint.url_validation challenge to activate a webhook subscription in the first place.
//
// S14x: after the signature check, the event goes through the provider event inbox (raw body stored, signature result stored, event +
// meeting uuid + event_ts as the idempotency key). The inbox is now the gate that stops a redelivery being acted on twice;
// zoom_webhook_events stays as the audit record it always was. A bad signature is stored 'rejected' and never acted on. If the inbox
// cannot be reached the event is handled directly, as before. The state updates are written so that running them twice, or running a
// late "started" after "ended", can never move a consultation backwards.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isSafeWebhookChallenge } from "../_shared/integrations/webhook-challenge.ts";
import { forwardPresenceEvent, isPresenceEvent, type ForwardOutcome } from "../_shared/integrations/webhook-forward.ts";
import { receiveProviderEvent, zoomEventKey, type Dispatch, type DispatchOutcome, type InboxStore } from "../_shared/integrations/webhook-inbox.ts";
import type { FetchLike } from "../_shared/integrations/http.ts";

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
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyZoomSignature(secret: string | null, rawBody: string, timestampHeader: string | null, signatureHeader: string | null): Promise<boolean> {
  // Fail closed, same posture as paystack-webhook: a forged event here could mark a real consultation started/ended, not just a fake
  // chat message, so an unconfigured secret must reject every request.
  if (!secret) {
    console.error("zoom-webhook: ZOOM_WEBHOOK_SECRET_TOKEN is not set — rejecting all events");
    return false;
  }
  if (!timestampHeader || !signatureHeader) return false;
  const expected = `v0=${await hmacHex(secret, `v0:${timestampHeader}:${rawBody}`)}`;
  return signatureHeader === expected;
}

export interface ZoomDeps {
  readonly secret: string | null;
  readonly db: SupabaseClient;
  readonly store: InboxStore | null;
  readonly appBaseUrl: string | undefined;
  readonly fetch: FetchLike;
}

/** Acts on a verified meeting event. Safe to run twice and safe out of order: a consultation never moves backwards. */
export function zoomDispatcher(db: SupabaseClient): Dispatch {
  return async (e): Promise<DispatchOutcome> => {
    let event: ZoomWebhookEvent;
    try {
      event = JSON.parse(e.rawBody) as ZoomWebhookEvent;
    } catch {
      return { ok: false, error: "invalid json", permanent: true };
    }
    const zoomMeetingId = event.payload?.object?.id !== undefined ? String(event.payload.object.id) : null;
    const providerEventId = e.idempotencyKey;

    // The audit record. A repeat of the same key is expected (a replay) and is not an error.
    const { data: inserted, error: insertError } = await db
      .from("zoom_webhook_events")
      .insert({ provider_event_id: providerEventId, event_type: event.event, raw_payload: event as unknown as Record<string, unknown> })
      .select("id")
      .maybeSingle();
    if (insertError && insertError.code !== "23505") {
      console.error("zoom-webhook: failed to record event", insertError);
      return { ok: false, error: "audit record failed" };
    }
    let auditId: string | null = inserted?.id ?? null;
    if (!auditId) {
      const { data: existing } = await db.from("zoom_webhook_events").select("id").eq("provider_event_id", providerEventId).maybeSingle();
      auditId = existing?.id ?? null;
    }
    const markProcessed = async (videoConsultationId?: string) => {
      if (!auditId) return;
      await db.from("zoom_webhook_events").update({ processed_at: new Date().toISOString(), video_consultation_id: videoConsultationId ?? null }).eq("id", auditId);
    };
    const markFailed = async (error: string) => {
      if (!auditId) return;
      await db.from("zoom_webhook_events").update({ error }).eq("id", auditId);
    };

    if (!zoomMeetingId) {
      await markFailed(`${event.event} missing payload.object.id`);
      return { ok: true };
    }

    try {
      switch (event.event) {
        case "meeting.started":
        case "meeting.ended": {
          const { data: consultation } = await db.from("video_consultations").select("id").eq("zoom_meeting_id", zoomMeetingId).maybeSingle();
          if (!consultation) {
            await markFailed(`no video_consultations row with zoom_meeting_id=${zoomMeetingId}`);
            return { ok: true };
          }
          if (event.event === "meeting.started") {
            // Never regress a finished (or already started) consultation: a replay or a late "started" is a no-op.
            await db.from("video_consultations").update({ status: "started", started_at: new Date().toISOString() }).eq("id", consultation.id).not("status", "in", "(started,completed)");
          } else {
            await db.from("video_consultations").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", consultation.id).neq("status", "completed");
          }
          await markProcessed(consultation.id);
          return { ok: true, entity: { type: "video_consultation", id: consultation.id } };
        }
        default:
          // Every other event type is still recorded above for audit but requires no state change.
          await markProcessed();
          return { ok: true };
      }
    } catch (error) {
      console.error("zoom-webhook: unhandled processing error", error);
      await markFailed(error instanceof Error ? error.message : "unknown processing error");
      return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : "processing error" };
    }
  };
}

export async function handleZoomWebhook(req: Request, deps: ZoomDeps): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();

  let event: ZoomWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 200 });
  }

  // Zoom's one-time handshake to activate the webhook subscription: echo back an HMAC of the plainToken it sends, unsigned (there's
  // nothing to verify yet — the secret itself is what proves we're the real endpoint).
  if (event.event === "endpoint.url_validation") {
    const plainToken = event.payload?.plainToken;
    if (!deps.secret || !plainToken) return Response.json({ ok: false, error: "not_configured" }, { status: 200 });
    // This answer is an HMAC under the SAME secret that signs real events, so an unchecked challenge is an oracle: sending
    // `v0:<timestamp>:<forged body>` would return the exact signature for that forged event. A real challenge is a plain token with no
    // colon or whitespace; anything else is refused (S21 review, mirrors apps/web/src/lib/consultations/presence.ts).
    if (!isSafeWebhookChallenge(plainToken)) return Response.json({ ok: false, error: "invalid_challenge" }, { status: 200 });
    return Response.json({ plainToken, encryptedToken: await hmacHex(deps.secret, plainToken) });
  }

  const timestamp = req.headers.get("x-zm-request-timestamp");
  const signature = req.headers.get("x-zm-signature");
  const verified = await verifyZoomSignature(deps.secret, rawBody, timestamp, signature);

  // A bad signature is kept for forensics (rejected, never dispatched) and answered exactly as before.
  if (!verified) {
    if (deps.store) await receiveProviderEvent(deps.store, { provider: "zoom", rawBody, verified: false, derive: () => zoomEventKey(rawBody) }, () => Promise.resolve({ ok: true }));
    return Response.json({ ok: false, error: "invalid_signature" }, { status: 200 });
  }

  // Zoom allows ONE event-subscription URL per app, and this is it. The consultation presence route (apps/web /api/zoom/webhook) needs the
  // participant events, so they are handed to it unchanged (it verifies the signature again itself) and not recorded here: the idempotency
  // key is built from the meeting, so two people joining the same meeting would collide and the second would be dropped as a replay.
  // If the route cannot be reached the answer is a 502 so Zoom sends the event again.
  if (isPresenceEvent(event.event)) {
    const outcome: ForwardOutcome = await forwardPresenceEvent(deps.fetch, deps.appBaseUrl, rawBody, { timestamp, signature });
    if (outcome === "retry") {
      console.error("zoom-webhook: could not hand a participant event to the presence route");
      return Response.json({ ok: false, error: "forward_failed" }, { status: 502 });
    }
    return Response.json({ ok: true, forwarded: outcome === "forwarded" });
  }

  const dispatch = zoomDispatcher(deps.db);
  if (deps.store) {
    const out = await receiveProviderEvent(deps.store, { provider: "zoom", rawBody, verified: true, derive: () => zoomEventKey(rawBody) }, dispatch);
    switch (out.kind) {
      case "processed": return Response.json({ ok: true });
      case "duplicate": return Response.json({ ok: true, replay: true });
      case "failed": return Response.json({ ok: false, error: "processing_failed" }, { status: out.status === "dead" ? 200 : 500 });
      case "rejected": return Response.json({ ok: false, error: "invalid_signature" }, { status: 200 });
      case "store_unavailable": break; // handled directly below
    }
  }
  const key = (await zoomEventKey(rawBody)).idempotencyKey;
  const direct = await dispatch({ provider: "zoom", eventType: event.event, idempotencyKey: key, rawBody });
  return direct.ok ? Response.json({ ok: true }) : Response.json({ ok: false, error: "processing_failed" }, { status: direct.permanent ? 200 : 500 });
}
