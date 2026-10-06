// S25: deployed entrypoint for order-verify. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseOrderStore } from "../_shared/commerce/index.ts";
import { paymentFromEnv } from "../_shared/integrations/index.ts";
import { handleVerify } from "./handler.ts";

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const payments = paymentFromEnv(
    { PAYSTACK_SECRET_KEY: Deno.env.get("PAYSTACK_SECRET_KEY"), PAYSTACK_WEBHOOK_SECRET: Deno.env.get("PAYSTACK_WEBHOOK_SECRET") },
    (input, init) => fetch(input, init),
  );
  return handleVerify(req, {
    commerce: payments ? { payments, store: supabaseOrderStore(service) } : null,
    rpcAsUser: (authorization, fn, args) =>
      createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }).rpc(fn, args),
  });
});
