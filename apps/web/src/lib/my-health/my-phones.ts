import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePhoneRows, type Database, type PhoneRow } from "@tarragon/shared";

export type MyPhonesResult = { ok: true; rows: PhoneRow[]; dropped: number } | { ok: false };

/**
 * The signed-in person's own phones. The table's select policy is `account_id = auth.uid()`, so this can never return anyone else's row.
 * Never throws: a failed read is `{ ok: false }` so the page says so instead of showing an empty list that reads as "no phones".
 */
export async function fetchMyPhones(supabase: SupabaseClient<Database>): Promise<MyPhonesResult> {
  const { data, error } = await supabase
    .from("offline_device_leases")
    .select("device_id, platform, device_label, shared_phone, last_checkin_at, lease_expires_at, revoked_at, wipe_confirmed_at, unsent_at_wipe, danger_at_wipe, retired_at")
    .order("last_checkin_at", { ascending: false })
    .limit(100);
  if (error || !Array.isArray(data)) return { ok: false };
  const { rows, dropped } = parsePhoneRows(data);
  return { ok: true, rows, dropped };
}

/** Rename and/or mark shared. Only the owner's own, not-yet-removed phone is touched (checked in the database). */
export async function updateMyPhone(
  supabase: SupabaseClient<Database>,
  deviceId: string,
  change: { label?: string | null; shared?: boolean }
): Promise<boolean> {
  const { error } = await supabase.rpc("update_my_offline_device", {
    p_device: deviceId,
    ...(change.label ? { p_label: change.label } : {}),
    ...(change.label === null ? { p_clear_label: true } : {}),
    ...(change.shared !== undefined ? { p_shared: change.shared } : {}),
  });
  return !error;
}

/** Asks for the phone to be cleared the next time it connects. */
export async function requestPhoneRemoval(supabase: SupabaseClient<Database>, deviceId: string): Promise<boolean> {
  const { error } = await supabase.rpc("request_offline_device_wipe", { p_device: deviceId, p_reason: "lost_phone" });
  return !error;
}
