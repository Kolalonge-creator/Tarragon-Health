// S73: deployed entrypoint for price-quote. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleQuote } from "./handler.ts";

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = (authorization: string) =>
    createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  return handleQuote(req, {
    whoami: async (authorization) => {
      const { data, error } = await asUser(authorization).auth.getUser();
      return error || !data.user ? null : { id: data.user.id };
    },
    rpcAsUser: (authorization, fn, args) => asUser(authorization).rpc(fn, args),
  });
});
