import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePhoneRows, PHONE_COLUMNS, phoneUpdateArgs, type Database, type PhoneRow } from "@tarragon/shared";

export type MyPhonesResult = { ok: true; rows: PhoneRow[]; dropped: number } | { ok: false };

async function readMyPhones(supabase: SupabaseClient<Database>): Promise<MyPhonesResult> {
  const { data, error } = await supabase.from("offline_device_leases").select(PHONE_COLUMNS).order("last_checkin_at", { ascending: false }).limit(100);
  if (error || !Array.isArray(data)) return { ok: false };
  const { rows, dropped } = parsePhoneRows(data);
  return { ok: true, rows, dropped };
}

/**
 * The signed-in person's own phones. The table's select policy is `account_id = auth.uid()`, so this can never return anyone else's row.
 * Never throws: a failed read is `{ ok: false }` so the page says so instead of showing an empty list that reads as "no phones".
 */
export async function fetchMyPhones(supabase: SupabaseClient<Database>): Promise<MyPhonesResult> {
  try {
    return await readMyPhones(supabase);
  } catch {
    return { ok: false };
  }
}

/** Rename and/or mark shared. Only the owner's own, not-yet-removed phone is touched (checked in the database). Never throws. */
export async function updateMyPhone(
  supabase: SupabaseClient<Database>,
  deviceId: string,
  change: { label?: string | null; shared?: boolean }
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("update_my_offline_device", phoneUpdateArgs(deviceId, change));
    return !error;
  } catch {
    return false;
  }
}

/** Asks for the phone to be cleared the next time it connects. Never throws; false means nothing was filed. */
export async function requestPhoneRemoval(supabase: SupabaseClient<Database>, deviceId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("request_offline_device_wipe", { p_device: deviceId, p_reason: "lost_phone" });
    return !error;
  } catch {
    return false;
  }
}
