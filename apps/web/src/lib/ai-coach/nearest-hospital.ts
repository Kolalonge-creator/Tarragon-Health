import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEmergencyAddendum,
  nearestHospitalsShown,
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

/** "Lagos State" and "lagos" are the same place. */
export function normaliseState(state: string | null | undefined): string | null {
  const s = (state ?? "").trim().toLowerCase().replace(/\s+state$/, "");
  return s ? s : null;
}

export function rankHospitals(
  rows: readonly { name: string; city: string | null; address: string | null; contact_phone: string | null; verified: boolean | null }[],
  patientCity: string | null | undefined,
  limit: number
): EmergencyHospital[] {
  const city = (patientCity ?? "").trim().toLowerCase();
  return [...rows]
    .sort((a, b) => {
      const ca = city && (a.city ?? "").trim().toLowerCase() === city ? 0 : 1;
      const cb = city && (b.city ?? "").trim().toLowerCase() === city ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const va = a.verified ? 0 : 1;
      const vb = b.verified ? 0 : 1;
      if (va !== vb) return va - vb;
      return a.name.localeCompare(b.name);
    })
    .slice(0, Math.max(limit, 0))
    .map((r) => ({ name: r.name, city: r.city, address: r.address, phone: r.contact_phone }));
}

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
      .ilike("state", `%${state.replace(/[%_]/g, "")}%`)
      .limit(50);
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
