// S25: deployed entrypoint for order-reconcile. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseOrderStore } from "../_shared/commerce/index.ts";
import { paymentFromEnv } from "../_shared/integrations/index.ts";
import { handleReconcile } from "./handler.ts";

Deno.serve((req) => {
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const payments = paymentFromEnv(
    { PAYSTACK_SECRET_KEY: Deno.env.get("PAYSTACK_SECRET_KEY"), PAYSTACK_WEBHOOK_SECRET: Deno.env.get("PAYSTACK_WEBHOOK_SECRET") },
    (input, init) => fetch(input, init),
  );
  return handleReconcile(req, {
    secret: Deno.env.get("ORDER_RECONCILE_SECRET") ?? null,
    commerce: payments ? { payments, store: supabaseOrderStore(service) } : null,
  });
});
