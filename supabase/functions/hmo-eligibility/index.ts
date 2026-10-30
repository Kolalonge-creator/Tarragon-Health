// S71: deployed entrypoint for hmo-eligibility. Wiring only; the logic is in handler.ts and the HMO connections in adapter.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleHmoEligibility } from "./handler.ts";

import { withSentry } from "../_shared/observability/sentry.ts";
import { withCors } from "../_shared/http/cors.ts";
// The web app calls this straight from the browser, so the preflight and every response need CORS headers (see _shared/http/cors.ts).
Deno.serve(withCors(withSentry("hmo-eligibility", (req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const asUser = (authorization: string) =>
    createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  return handleHmoEligibility(req, {
    adaptersConfig: Deno.env.get("HMO_ADAPTERS") ?? null,
    whoami: async (authorization) => {
      const { data, error } = await asUser(authorization).auth.getUser();
      return error || !data.user ? null : { id: data.user.id };
    },
    rpcAsUser: (authorization, fn, args) => asUser(authorization).rpc(fn, args),
    rpcAsService: (fn, args) => service.rpc(fn, args),
  });
})));
