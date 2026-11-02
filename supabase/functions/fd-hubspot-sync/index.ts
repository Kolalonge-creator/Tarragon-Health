// Deployed entrypoint for fd-hubspot-sync. Wiring only; the logic and its header are in handler.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHubspotClient, type ClaimedCrmRow } from "../_shared/frontdesk/index.ts";
import { handleSync } from "./handler.ts";

Deno.serve((req) => {
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN");
  return handleSync(req, {
    secret: Deno.env.get("FD_FOLLOWUP_SECRET") ?? null,
    client: token ? createHubspotClient({ token, fetch: (input, init) => fetch(input, init) }) : null,
    claim: async (limit) => {
      const { data, error } = await service.rpc("service_fd_hubspot_claim", { p_limit: limit });
      return error ? { ok: false, error: error.message } : { ok: true, rows: (data ?? []) as ClaimedCrmRow[] };
    },
    finish: async (outboxId, ok, hubspotId, stage, sales, err) => {
      const { error } = await service.rpc("service_fd_hubspot_finish", { p_outbox: outboxId, p_ok: ok, p_hubspot_id: hubspotId, p_stage: stage, p_sales: sales, p_error: err });
      if (error) throw new Error(`could not record the outcome of CRM write ${outboxId}: ${error.message}`);
    },
  });
});
