import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** `partner_event_map` and `event_types` are not in the generated types yet (the types are spliced per branch), so these two reads use an untyped client. The row shapes are the interfaces below. */
async function untyped(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

/**
 * Reads for the partner webhook screens (S10x follow-up). Admin only (the tables' row policies and the page both say so). The endpoint read
 * names its columns: the signing secret and the previous secret are NEVER selected, so they cannot reach a page, a log or a cache. Each read
 * reports a failure as failed, never as an empty list.
 */
export interface EndpointRow {
  id: string;
  name: string;
  environment: string;
  is_active: boolean;
  consecutive_failures: number;
  signing_key_version: number;
  previous_secret_expires_at: string | null;
  auto_disabled_at: string | null;
  disabled_reason: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  event_types: string[];
}

export interface MappingRow {
  bus_event_type: string;
  integration_event_type: string;
  subscriber_key: string;
  id_keys: string[];
}

export async function loadEndpoints(): Promise<{ rows: EndpointRow[]; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("partner_webhook_endpoints")
    .select(
      "id, name, environment, is_active, consecutive_failures, signing_key_version, previous_secret_expires_at, auto_disabled_at, disabled_reason, last_success_at, last_failure_at, event_types",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return { rows: [], failed: true };
  return { rows: data as EndpointRow[], failed: false };
}

export async function loadMappings(): Promise<{ rows: MappingRow[]; failed: boolean }> {
  const supabase = await untyped();
  const { data, error } = await supabase.from("partner_event_map").select("bus_event_type, integration_event_type, subscriber_key, id_keys").order("bus_event_type");
  if (error || !data) return { rows: [], failed: true };
  return { rows: data as MappingRow[], failed: false };
}

export async function loadBusEventTypes(): Promise<{ rows: string[]; failed: boolean }> {
  const supabase = await untyped();
  const { data, error } = await supabase.from("event_types").select("event_type").eq("is_active", true).order("event_type");
  if (error || !data) return { rows: [], failed: true };
  return { rows: (data as { event_type: string }[]).map((r) => r.event_type), failed: false };
}
