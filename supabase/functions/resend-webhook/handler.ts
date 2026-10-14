// S13 / S14x: Resend webhook logic. Records delivered, bounced and complained outcomes against the notification whose
// provider_message_id matches Resend's email_id. A hard bounce or a spam complaint suppresses that address (the sender checks
// notification_email_suppressions). The Svix signature is checked before anything is read; no secret means nothing is accepted.
// `delivered` means the recipient's mail server accepted it, not that anyone read it.
//
// S14x: the event goes through the provider event inbox first (raw body stored, signature result stored, the Svix message id as the
// idempotency key), so a redelivery is processed once, a failure is retried by the drain function, and a bad signature is kept as
// 'rejected' and never acted on. If the inbox cannot be reached (for example the migration is not applied yet) the event is handled
// directly, exactly as before: a missing inbox must never stop delivery outcomes being recorded.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { mapResendEvent, verifySvix, type ResendEvent } from "../_shared/notifications/resend.ts";
import { receiveProviderEvent, resendEventKey, type Dispatch, type DispatchOutcome, type InboxStore } from "../_shared/integrations/webhook-inbox.ts";

/** The service-role client. Typed as the real client (as paystack-webhook does); tests pass a small fake cast to it. */
export type ResendDb = SupabaseClient;
export interface ResendDeps {
  readonly secret: string | null;
  readonly db: ResendDb;
  readonly store: InboxStore | null;
  readonly nowMs: () => number;
}

/** The part that acts on a verified event. Safe to run twice: the delivery-event writer is keyed by notification and event. */
export function resendDispatcher(db: ResendDb): Dispatch {
  return async (e): Promise<DispatchOutcome> => {
    let evt: ResendEvent;
    try {
      evt = JSON.parse(e.rawBody) as ResendEvent;
    } catch {
      return { ok: false, error: "bad json", permanent: true };
    }
    const mapped = mapResendEvent(evt);
    if (!mapped) return { ok: true }; // a type we do not track: acknowledge so Resend stops retrying
    const found = await db.from("notifications").select("id").eq("provider_message_id", mapped.emailId).maybeSingle();
    if (found.error) return { ok: false, error: "notification lookup failed" };
    const n = found.data as { id?: string } | null;
    if (!n?.id) return { ok: true }; // not ours, or sent before tracking
    const { error } = await db.rpc("record_notification_delivery_event", {
      p_notification_id: n.id,
      p_event: mapped.event,
      p_provider: "resend",
      p_provider_ref: mapped.emailId,
      p_detail: mapped.email ? { email: mapped.email } : {},
    });
    // A 500 makes Resend retry, which is right: the outcome has not been recorded yet.
    if (error) return { ok: false, error: "record failed" };
    return { ok: true, entity: { type: "notification", id: n.id } };
  };
}

export async function handleResendWebhook(req: Request, deps: ResendDeps): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  const body = await req.text();
  const svixId = req.headers.get("svix-id");
  const verified = await verifySvix(
    deps.secret,
    { id: svixId, timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") },
    body,
    deps.nowMs(),
  );
  const dispatch = resendDispatcher(deps.db);

  if (deps.store) {
    const out = await receiveProviderEvent(deps.store, { provider: "resend", rawBody: body, verified, derive: () => resendEventKey(body, svixId) }, dispatch);
    switch (out.kind) {
      case "rejected": return Response.json({ error: "bad signature" }, { status: 401 });
      case "processed": return Response.json(out.entity ? { recorded: true } : { ignored: true });
      case "duplicate": return Response.json({ duplicate: true });
      case "failed": return out.status === "dead" ? Response.json({ error: "bad json" }, { status: 400 }) : Response.json({ error: "record failed" }, { status: 500 });
      case "store_unavailable": break; // fall through to the direct path below
    }
  }

  if (!verified) return Response.json({ error: "bad signature" }, { status: 401 });
  const direct = await dispatch({ provider: "resend", eventType: "direct", idempotencyKey: "direct", rawBody: body });
  if (direct.ok) return Response.json(direct.entity ? { recorded: true } : { ignored: true });
  return direct.permanent ? Response.json({ error: "bad json" }, { status: 400 }) : Response.json({ error: "record failed" }, { status: 500 });
}
