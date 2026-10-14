// Tarragon Health — Zoom webhook, deployed entrypoint. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseInboxStore } from "../_shared/integrations/webhook-inbox.ts";
import { withSentry } from "../_shared/observability/sentry.ts";
import { handleZoomWebhook } from "./handler.ts";

Deno.serve(withSentry("zoom-webhook", (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return handleZoomWebhook(req, {
    secret: Deno.env.get("ZOOM_WEBHOOK_SECRET_TOKEN") ?? null,
    db: supabase,
    store: supabaseInboxStore(supabase),
    appBaseUrl: Deno.env.get("APP_BASE_URL"),
    fetch: (url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal }),
  });
}));
