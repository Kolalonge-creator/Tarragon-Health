import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type KnownDevice = {
  id: string;
  userAgent: string | null;
  lastIp: string | null;
  lastSeenAt: string;
  signInCount: number;
};

/**
 * The caller's own recognised devices/browsers (2026-09-18 security audit —
 * `/account`'s "sign out everywhere else" card previously offered no
 * visibility at all into what it was signing out of, just a blunt button).
 *
 * Reads `public.user_known_devices` — the table `record_login_device()`
 * (20260829223329_known_device_login_notification.sql) already writes on
 * every sign-in, RLS-scoped to the caller's own rows. This is device
 * *history*, not a live session list: Supabase Auth's own session store
 * (`auth.sessions`) is where actual revocable sessions live, and there is no
 * client-safe way to read or revoke an individual one of those without the
 * service-role admin API — see the "Devices" card's own copy for why the
 * one action available is still "sign out everywhere else", not a per-row
 * revoke.
 */
export async function getKnownDevices(
  supabase: SupabaseClient<Database>
): Promise<KnownDevice[]> {
  const { data, error } = await supabase
    .from("user_known_devices")
    .select("id, user_agent, last_ip, last_seen_at, sign_in_count")
    .order("last_seen_at", { ascending: false })
    .limit(10);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    userAgent: row.user_agent,
    lastIp: row.last_ip,
    lastSeenAt: row.last_seen_at,
    signInCount: row.sign_in_count,
  }));
}
