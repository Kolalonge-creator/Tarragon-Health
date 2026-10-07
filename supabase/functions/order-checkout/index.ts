// S25: deployed entrypoint for order-checkout. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseOrderStore } from "../_shared/commerce/index.ts";
import { paymentFromEnv } from "../_shared/integrations/index.ts";
import { handleCheckout } from "./handler.ts";

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const asUser = (authorization: string) =>
    createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const payments = paymentFromEnv(
    { PAYSTACK_SECRET_KEY: Deno.env.get("PAYSTACK_SECRET_KEY"), PAYSTACK_WEBHOOK_SECRET: Deno.env.get("PAYSTACK_WEBHOOK_SECRET") },
    (input, init) => fetch(input, init),
  );
  return handleCheckout(req, {
    payments,
    store: supabaseOrderStore(service),
    returnUrl: Deno.env.get("ORDER_RETURN_URL") ?? null,
    whoami: async (authorization) => {
      const { data, error } = await asUser(authorization).auth.getUser();
      return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null };
    },
    rpcAsUser: (authorization, fn, args) => asUser(authorization).rpc(fn, args),
  });
});
