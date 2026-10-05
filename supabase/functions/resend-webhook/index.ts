// S13: Resend webhook. Records delivered, bounced and complained outcomes against the notification whose
// provider_message_id matches Resend's email_id. A hard bounce or a spam complaint suppresses that address (the sender
// checks notification_email_suppressions). The Svix signature is checked before anything is read; no secret means
// nothing is accepted. `delivered` means the recipient's mail server accepted it, not that anyone read it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { mapResendEvent, verifySvix, type ResendEvent } from "../_shared/notifications/resend.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return Response.json({ error: "not configured" }, { status: 503 });
  const body = await req.text();
  const ok = await verifySvix(
    secret,
    { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") },
    body,
    Date.now(),
  );
  if (!ok) return Response.json({ error: "bad signature" }, { status: 401 });

  let evt: ResendEvent;
  try { evt = JSON.parse(body) as ResendEvent; } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const mapped = mapResendEvent(evt);
  if (!mapped) return Response.json({ ignored: true }); // a type we do not track: acknowledge so Resend stops retrying

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: n } = await supabase
    .from("notifications").select("id").eq("provider_message_id", mapped.emailId).maybeSingle<{ id: string }>();
  if (!n) return Response.json({ ignored: true, reason: "unknown email id" }); // not ours, or sent before tracking
  const { error } = await supabase.rpc("record_notification_delivery_event", {
    p_notification_id: n.id,
    p_event: mapped.event,
    p_provider: "resend",
    p_provider_ref: mapped.emailId,
    p_detail: mapped.email ? { email: mapped.email } : {},
  });
  // A 500 makes Resend retry, which is right: the outcome has not been recorded yet.
  if (error) return Response.json({ error: "record failed" }, { status: 500 });
  return Response.json({ recorded: mapped.event });
});
