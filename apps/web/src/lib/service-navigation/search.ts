import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type FacilityMatch = {
  id: string;
  name: string;
  type: Database["public"]["Enums"]["facility_type"];
  state: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  contact_phone: string | null;
  hours: string | null;
};

const FACILITY_MATCH_LIMIT = 5;

/**
 * Real rows only, same curated directory facility-selector.tsx already
 * reads from (queries/facilities.ts) -- "curated, admin-maintained
 * directory, no organisation_id scoping". Capped at
 * FACILITY_MATCH_LIMIT: this feeds an AI-phrased answer, not a full
 * results page, and the minimized-snapshot discipline used everywhere
 * else in this codebase's AI features applies here too.
 */
export async function findRelevantFacilities(
  supabase: SupabaseClient<Database>,
  filters: {
    type?: Database["public"]["Enums"]["facility_type"] | null;
    state?: string | null;
    city?: string | null;
    area?: string | null;
  }
): Promise<FacilityMatch[]> {
  let query = supabase
    .from("facilities")
    .select("id, name, type, state, city, area, address, contact_phone, hours")
    .eq("is_active", true);

  if (filters.type) query = query.eq("type", filters.type);
  if (filters.state) query = query.ilike("state", `%${filters.state}%`);
  if (filters.city) query = query.ilike("city", `%${filters.city}%`);
  if (filters.area) query = query.ilike("area", `%${filters.area}%`);

  const { data, error } = await query.order("name", { ascending: true }).limit(FACILITY_MATCH_LIMIT);
  if (error) throw error;
  return data ?? [];
}
