import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEmergencyAddendum,
  nearestHospitalsShown,
  normaliseState,
  rankHospitals,
  type Database,
  type EmergencyAddendumInput,
  type EmergencyHospital,
} from "@tarragon/shared";

/**
 * S52 (7.8, INV-06): what the emergency reply adds after its fixed copy, read from data the platform already holds.
 *   - hospitals: active `facilities` of type hospital in the patient's state, the patient's own city first, verified listings first.
 *     Nobody is ranked by anything but nearness and verification (never by price or partnership).
 *   - the patient's own saved emergency contact (name and number), from their own profile.
 * BEST EFFORT and bounded: every read is guarded and the whole thing gives up after a short time. The fixed emergency copy never waits
 * on this, and an empty result is a normal result (the copy stands alone).
 */
const READ_TIMEOUT_MS = 2500;

async function read(supabase: SupabaseClient<Database>, patientId: string): Promise<EmergencyAddendumInput> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("state, city, emergency_contact_name, emergency_contact_phone")
    .eq("id", patientId)
    .maybeSingle();
  const state = normaliseState(profile?.state);
  let hospitals: EmergencyHospital[] = [];
  if (state) {
    const { data } = await supabase
      .from("facilities")
      .select("name, city, address, contact_phone, verified, state")
      .eq("type", "hospital")
      .eq("is_active", true)
      .ilike("state", `%${state.replace(/[%_\\]/g, "")}%`)
      .order("name", { ascending: true })
      .limit(500);
    hospitals = rankHospitals(data ?? [], profile?.city, nearestHospitalsShown());
  }
  return {
    hospitals,
    contactName: profile?.emergency_contact_name?.trim() || null,
    contactPhone: profile?.emergency_contact_phone?.trim() || null,
  };
}

export async function loadEmergencyContext(supabase: SupabaseClient<Database>, patientId: string): Promise<EmergencyAddendumInput> {
  const empty: EmergencyAddendumInput = { hospitals: [], contactName: null, contactPhone: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(supabase, patientId),
      new Promise<EmergencyAddendumInput>((resolve) => {
        timer = setTimeout(() => resolve(empty), READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return empty;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function emergencyAddendumFor(supabase: SupabaseClient<Database>, patientId: string): Promise<string> {
  return buildEmergencyAddendum(await loadEmergencyContext(supabase, patientId));
}
