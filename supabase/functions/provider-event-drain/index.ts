// S14x: deployed entrypoint for provider-event-drain. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { hmacHex } from "../_shared/integrations/crypto.ts";
import { supabaseInboxStore, type Dispatch } from "../_shared/integrations/webhook-inbox.ts";
import { outcomeOfResponse } from "../paystack-webhook/inbox-branch.ts";
import { processVerifiedEvent, type PaystackEvent } from "../paystack-webhook/handler.ts";
import { resendDispatcher } from "../resend-webhook/handler.ts";
import { zoomDispatcher } from "../zoom-webhook/handler.ts";
import { handleDrain } from "./handler.ts";

Deno.serve((req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // The inbox only ever holds events whose signature already verified, so the signature the order branch wants is recomputed
  // from the stored raw body with the same secret: it equals the one Paystack sent.
  const paystack: Dispatch = async (e) => {
    const secret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET");
    if (!secret) return { ok: false, error: "PAYSTACK_WEBHOOK_SECRET is not set" };
    let event: PaystackEvent;
    try {
      event = JSON.parse(e.rawBody) as PaystackEvent;
    } catch {
      return { ok: false, error: "invalid_json", permanent: true };
    }
    const signature = await hmacHex("SHA-512", secret, e.rawBody);
    return await outcomeOfResponse(await processVerifiedEvent(e.rawBody, event, signature, supabase));
  };
  return handleDrain(req, {
    secret: Deno.env.get("PROVIDER_DRAIN_SECRET") ?? null,
    store: supabaseInboxStore(supabase),
    dispatchers: { paystack, zoom: zoomDispatcher(supabase), resend: resendDispatcher(supabase) },
  });
});
