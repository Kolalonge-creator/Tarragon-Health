import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@tarragon/shared";

export type EndpointRow = Database["public"]["Functions"]["partner_webhook_admin_overview"]["Returns"][number];
export type MappingRow = Database["public"]["Functions"]["partner_event_map_admin_overview"]["Returns"][number];

/** Both reads are admin-only database functions that never return a secret. A failure is reported as failed, never as an empty list. */
export async function loadEndpoints(): Promise<{ rows: EndpointRow[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partner_webhook_admin_overview");
  if (error || !data) return { rows: [], failed: true };
  return { rows: data, failed: false };
}

export async function loadMappings(): Promise<{ rows: MappingRow[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("partner_event_map_admin_overview");
  if (error || !data) return { rows: [], failed: true };
  return { rows: data, failed: false };
}
