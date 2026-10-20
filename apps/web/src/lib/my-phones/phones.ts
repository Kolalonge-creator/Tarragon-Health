import type { SupabaseClient } from "@supabase/supabase-js";
import { PHONE_ROW_COLUMNS, type PhoneLeaseRow } from "@tarragon/shared";

export type PhonesResult = { ok: true; phones: PhoneLeaseRow[] } | { ok: false };

const isRow = (r: unknown): r is PhoneLeaseRow =>
  typeof r === "object" &&
  r !== null &&
  typeof (r as PhoneLeaseRow).device_id === "string" &&
  typeof (r as PhoneLeaseRow).platform === "string" &&
  typeof (r as PhoneLeaseRow).last_checkin_at === "string" &&
  typeof (r as PhoneLeaseRow).lease_expires_at === "string";

/**
 * The signed-in person's own phones (the table's row policy returns nothing else). A failed read is `{ ok: false }`, never an empty list
 * that would read as "no phones keep my entries".
 */
export async function fetchMyPhones(supabase: SupabaseClient): Promise<PhonesResult> {
  const { data, error } = await supabase
    .from("offline_device_leases")
    .select(PHONE_ROW_COLUMNS)
    .order("last_checkin_at", { ascending: false })
    .limit(50);
  if (error || !Array.isArray(data)) return { ok: false };
  return { ok: true, phones: (data as unknown[]).filter(isRow) };
}

/**
 * "This phone was lost". The server records the request (and audits it); the phone itself makes one last upload attempt and clears
 * itself the next time it connects. Returns whether the request was accepted.
 */
export async function reportPhoneLost(supabase: SupabaseClient, deviceId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("request_offline_device_wipe", { p_device: deviceId, p_reason: "lost_phone" });
  return !error && data === true;
}
