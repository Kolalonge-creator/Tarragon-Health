import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

export type SpecialistProvider = Tables<"specialist_providers">;
export type SpecialistType = Enums<"specialist_type">;

export const SPECIALIST_TYPES: SpecialistType[] = [
  "cardiology",
  "endocrinology",
  "nephrology",
  "ophthalmology",
  "urologist",
  "oncologist",
  "ob_gyn",
  "dietetics",
  "podiatry",
  "psychiatry",
  "psychology",
  "other",
];

export interface SpecialistSearchFilters {
  specialistType: SpecialistType;
  state?: string;
  city?: string;
  requireTelemedicine?: boolean;
  maxFeeKobo?: number;
  language?: string;
}

/**
 * Patient-initiated specialist browsing — mirrors apps/web/.../
 * find-a-specialist/find-a-specialist.tsx and its useMatchedSpecialistProviders
 * hook exactly (same filters, same state/city locality sort). Deliberately
 * read-only/informational: there's no "choose this specialist" action, since
 * assigning a specialist_provider only makes sense against an
 * already-open specialist_referrals row a clinician has created — a patient
 * who finds someone here messages their care team to arrange the referral,
 * same as web.
 */
export async function searchSpecialistProviders(
  filters: SpecialistSearchFilters
): Promise<QueryResult<SpecialistProvider[]>> {
  let query = supabase
    .from("specialist_providers")
    .select("*")
    .eq("specialist_type", filters.specialistType)
    .eq("is_active", true);
  if (filters.requireTelemedicine) query = query.eq("supports_telemedicine", true);
  if (typeof filters.maxFeeKobo === "number") query = query.lte("consultation_fee_kobo", filters.maxFeeKobo);
  if (filters.language) query = query.contains("languages", [filters.language]);

  const { data, error } = await query.order("name", { ascending: true });
  if (error) return { ok: false, error: error.message };

  const providers = data as SpecialistProvider[];
  if (!filters.state) return { ok: true, data: providers };

  const score = (p: SpecialistProvider) => {
    if (p.state !== filters.state) return 2;
    return filters.city && p.city === filters.city ? 0 : 1;
  };
  return {
    ok: true,
    data: [...providers].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)),
  };
}

export async function loadPatientLocation(patientId: string): Promise<{ state: string | null; city: string | null }> {
  const { data } = await supabase.from("profiles").select("state, city").eq("id", patientId).maybeSingle();
  return { state: data?.state ?? null, city: data?.city ?? null };
}
