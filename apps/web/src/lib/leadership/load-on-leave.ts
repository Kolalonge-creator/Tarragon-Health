import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type OnLeaveDoctor = { name: string; until: string };

/**
 * Clinicians on leave right now (provider_time_off of kind 'leave' covering now), one line per clinician with the latest end.
 * Null when the read failed. Shared by the clinician home's oversight block (DW-14) and the CMO's Leadership Overview.
 */
export async function loadOnLeave(supabase: SupabaseClient<Database>, now: Date): Promise<OnLeaveDoctor[] | null> {
  const nowIso = now.toISOString();
  const res = await supabase
    .from("provider_time_off")
    .select("clinician_id, ends_at, clinician:profiles!provider_time_off_clinician_id_fkey(full_name)")
    .eq("kind", "leave")
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .returns<{ clinician_id: string; ends_at: string; clinician: { full_name: string | null } | null }[]>();
  if (res.error) return null;
  const latest = new Map<string, OnLeaveDoctor>();
  for (const l of res.data ?? []) {
    const prev = latest.get(l.clinician_id);
    if (!prev || l.ends_at > prev.until) latest.set(l.clinician_id, { name: l.clinician?.full_name ?? "A clinician", until: l.ends_at });
  }
  return [...latest.values()];
}
