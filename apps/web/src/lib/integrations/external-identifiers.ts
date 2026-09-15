import "server-only";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@tarragon/shared";

/**
 * §33.13 — external identifier mapping. Tarragon id <-> partner id, scoped
 * per partner_integration because two partners routinely hold different
 * identifiers for the same patient (see public.external_identifier_map's
 * own migration comment for the full rationale).
 *
 * Deliberately thin: both functions are direct wrappers over the table so a
 * gateway handler never has to know the table's unique-index shape. Neither
 * throws on a not-found lookup — a missing mapping is a normal "we haven't
 * seen this partner's id before" state, not an error.
 */

type EntityType = Database["public"]["Enums"]["external_entity_type"];

export async function resolveTarragonId(
  supabase: ReturnType<typeof createServiceRoleClient>,
  partnerIntegrationId: string,
  entityType: EntityType,
  externalId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("external_identifier_map")
    .select("tarragon_id")
    .eq("partner_integration_id", partnerIntegrationId)
    .eq("entity_type", entityType)
    .eq("external_id", externalId)
    .maybeSingle();
  return data?.tarragon_id ?? null;
}

export async function resolveExternalId(
  supabase: ReturnType<typeof createServiceRoleClient>,
  partnerIntegrationId: string,
  entityType: EntityType,
  tarragonId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("external_identifier_map")
    .select("external_id")
    .eq("partner_integration_id", partnerIntegrationId)
    .eq("entity_type", entityType)
    .eq("tarragon_id", tarragonId)
    .maybeSingle();
  return data?.external_id ?? null;
}

/**
 * Records (or updates) a partner's identifier for one of our records. Both
 * unique indexes on external_identifier_map (per-external-id and
 * per-tarragon-id, within the same partner+entity_type) make this safe to
 * call repeatedly for the same pair — an upsert, not an insert-or-fail.
 */
export async function upsertExternalIdentifier(
  supabase: ReturnType<typeof createServiceRoleClient>,
  input: {
    organisationId: string;
    partnerIntegrationId: string;
    entityType: EntityType;
    tarragonId: string;
    externalId: string;
    externalSystem?: string | null;
  }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("external_identifier_map")
    .upsert(
      {
        organisation_id: input.organisationId,
        partner_integration_id: input.partnerIntegrationId,
        entity_type: input.entityType,
        tarragon_id: input.tarragonId,
        external_id: input.externalId,
        external_system: input.externalSystem ?? null,
      },
      { onConflict: "partner_integration_id,entity_type,tarragon_id" }
    );
  return { error: error?.message ?? null };
}
