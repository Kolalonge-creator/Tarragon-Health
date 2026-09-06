import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@tarragon/shared";

/**
 * Thin wrapper over public.enqueue_integration_event (§33.10/§33.15) for
 * app code that raises a business event a partner may be subscribed to —
 * e.g. a lab result finalised, an appointment cancelled. Server-only and
 * service-role-only: enqueue_integration_event's own EXECUTE grant is
 * restricted to service_role (see the
 * integration_queue_rpcs_to_public_schema migration), so this is the only
 * supported call site.
 *
 * §33.7 data minimisation lives HERE, at the call site, not in the queue
 * table: only the caller building a specific event knows what its
 * SUBSCRIBED PARTNER is entitled to see (a lab needs the order + clinical
 * indication, never the patient's full record) — the payload passed in must
 * already be the minimised shape, this function does not inspect or trim it.
 *
 * Never throws: a webhook subscriber being unreachable, or nobody
 * subscribing at all, must never fail the clinical action that triggered
 * the event (finalising a result, cancelling an appointment). Returns the
 * number of endpoints the event was actually queued for, mainly so a caller
 * can log "0 subscribers" for its own visibility without that being an
 * error path.
 */
export async function enqueueIntegrationEvent(input: {
  organisationId: string;
  eventType: Database["public"]["Enums"]["integration_event_type"];
  payload: Json;
  /** Stable id for the underlying business event (e.g. the result id) —
   * used verbatim as part of the per-endpoint dedupe key, so raising the
   * same event twice for the same record is always a no-op. */
  dedupeKey: string;
  environment?: Database["public"]["Enums"]["api_environment"];
}): Promise<number> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("enqueue_integration_event", {
      p_organisation_id: input.organisationId,
      p_event_type: input.eventType,
      p_payload: input.payload,
      p_dedupe_key: input.dedupeKey,
      p_environment: input.environment ?? "live",
    });
    if (error) return 0;
    return data ?? 0;
  } catch {
    return 0;
  }
}
