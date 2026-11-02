// Front Desk CRM sync: POST /functions/v1/fd-hubspot-sync. pg_cron calls this every 5 minutes (only while hubspot_enabled is on and there is
// something due) with the vault secret fd_followup_secret in x-fd-followup-secret. The database decides what is due; this talks to HubSpot.
// Fails closed without its secret, and claims nothing without a HubSpot token (rows simply wait).
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";
import { syncToHubspot, type HubspotClient, type HubspotSyncDeps } from "../_shared/frontdesk/index.ts";

export interface HandlerDeps {
  readonly secret: string | null;
  readonly client: HubspotClient | null;
  readonly claim: HubspotSyncDeps["claim"];
  readonly finish: HubspotSyncDeps["finish"];
}

export async function handleSync(req: Request, deps: HandlerDeps): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("x-fd-followup-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!deps.client) return Response.json({ error: "hubspot_not_configured" }, { status: 503 });
  const result = await syncToHubspot({ client: deps.client, claim: deps.claim, finish: deps.finish });
  if ("error" in result) return Response.json({ error: "claim_failed" }, { status: 500 });
  if (result.unrecorded > 0) return Response.json(result, { status: 500 });
  return Response.json(result);
}
