import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  WEARABLE_CREDENTIAL_COLUMNS,
  type WearableConnectionCredentials,
} from "@/lib/wearables/connection-tokens";
import { PULL_PROVIDERS } from "@/lib/wearables/providers";
import { pullConnection } from "@/lib/wearables/sync";

/**
 * Scheduled sweep for pull-only wearable providers (Vercel Cron, see
 * apps/web/vercel.json).
 *
 * Dexcom has no webhook mechanism at all — its v3 API is polled — so without
 * this a connected Dexcom account would sit there authorised and silent
 * forever. Every other provider pushes, and their readings arrive through
 * api/wearables/webhook/[provider] instead; this route deliberately does not
 * duplicate them, since polling a provider that already pushes is how the
 * same reading ends up ingested twice under two different derivations of an
 * external_reading_id.
 *
 * Each connection is resumed from its own sync_cursor with a small overlap
 * (see pullConnection), so a run that fails or a deploy that lands mid-sweep
 * costs a repeated window rather than a gap. Failures are per-connection: a
 * single revoked token marks that connection and the sweep carries on.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron
 * routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: connections, error } = await supabase
    .from("wearable_connections")
    .select(`${WEARABLE_CREDENTIAL_COLUMNS}, sync_cursor`)
    .in("provider", PULL_PROVIDERS)
    .eq("status", "active");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const totals = {
    connectionsConsidered: connections?.length ?? 0,
    connectionsSynced: 0,
    vitalsInserted: 0,
    wearableInserted: 0,
    implausible: 0,
  };

  for (const row of connections ?? []) {
    const connection = row as WearableConnectionCredentials & { sync_cursor: string | null };
    const outcome = await pullConnection(supabase, connection, connection.sync_cursor);
    totals.connectionsSynced += outcome.connectionsTouched;
    totals.vitalsInserted += outcome.vitalsInserted;
    totals.wearableInserted += outcome.wearableInserted;
    totals.implausible += outcome.implausible;
  }

  return Response.json(totals);
}
