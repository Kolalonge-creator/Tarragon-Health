import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@tarragon/shared";

export type PartnerEndpointRow = Database["public"]["Functions"]["admin_list_partner_webhook_endpoints"]["Returns"][number];
export type PartnerMappingRow = Database["public"]["Functions"]["admin_list_partner_event_mappings"]["Returns"][number];

/** Both reads are admin-only database functions. A failure is returned as `failed` so the page shows a failure card, never an empty healthy list. */
export async function loadPartnerEndpoints(): Promise<{ rows: PartnerEndpointRow[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_partner_webhook_endpoints");
  if (error || !data) return { rows: [], failed: true };
  return { rows: data, failed: false };
}

export async function loadPartnerMappings(): Promise<{ rows: PartnerMappingRow[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_partner_event_mappings");
  if (error || !data) return { rows: [], failed: true };
  return { rows: data, failed: false };
}
