import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * S70: the `device.synced` event (Module 18). Ids and counts only, never a value (INV-07): the payload the database builds names
 * a provider, a source kind and two counts. Best effort by design. A sync that stored its readings is a success whether or not
 * the bus accepted the event, so this reports a failure to its caller instead of throwing.
 */
export type SyncKind = "ble" | "wearable_cloud" | "health_store" | "cgm" | "photo";

export async function recordDeviceSync(
  svc: SupabaseClient<Database>,
  args: { patientId: string; provider: string; sourceKind: SyncKind; readingCount: number; duplicateCount?: number }
): Promise<void> {
  if (args.readingCount <= 0) return;
  const { error } = await svc.rpc("record_device_sync", {
    p_patient: args.patientId,
    p_provider: args.provider,
    p_source_kind: args.sourceKind,
    p_reading_count: args.readingCount,
    p_duplicate_count: args.duplicateCount ?? 0,
  });
  if (error) throw new Error(`device.synced was not recorded: ${error.message}`);
}
