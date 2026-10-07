// Tarragon Health — Paystack webhook (Sprint 6: subscriptions/payments)
//
// This is the deployed entrypoint (Supabase requires the file at this exact
// path/name) — it does nothing but wire a real SupabaseClient into
// handleWebhookRequest and call Deno.serve, unconditionally, exactly the
// same shape every other edge function in this repo uses. All the actual
// logic, and its full header/correlation-notes comment, live in
// handler.ts — split out 2026-09-23 specifically so this file's own runtime
// behaviour could stay untouched while handler.ts gained test coverage. See
// handler.ts's own comment on handleWebhookRequest for why an
// `import.meta.main`-guarded Deno.serve living in this same file was
// deliberately rejected in favour of this split.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleWebhookRequest } from "./handler.ts";

Deno.serve((req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return handleWebhookRequest(req, supabase);
});
