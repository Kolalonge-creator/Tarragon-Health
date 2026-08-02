import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { VerifiedApiKey } from "@/lib/integrations/api-key";

/**
 * Best-effort, non-blocking usage log for every Protocol API call --
 * mirrors api_keys.last_used_at's own "never throws, never awaited by the
 * caller's response" discipline in device-readings/route.ts. A logging
 * failure must never turn a working classification into a 500.
 */
export function logProtocolApiUsage(verified: VerifiedApiKey, endpoint: string): void {
  const supabase = createServiceRoleClient();
  void supabase
    .from("protocol_api_usage_log")
    .insert({ organisation_id: verified.organisationId, api_key_id: verified.keyId, endpoint })
    .then(() => undefined);
}
