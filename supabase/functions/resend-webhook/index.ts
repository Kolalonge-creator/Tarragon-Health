// S13 / S14x: deployed entrypoint for resend-webhook. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseInboxStore } from "../_shared/integrations/webhook-inbox.ts";
import { handleResendWebhook } from "./handler.ts";

Deno.serve((req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  return handleResendWebhook(req, {
    secret: Deno.env.get("RESEND_WEBHOOK_SECRET") ?? null,
    db: supabase,
    store: supabaseInboxStore(supabase),
    nowMs: () => Date.now(),
  });
});
