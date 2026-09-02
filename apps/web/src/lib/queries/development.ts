import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { DevelopmentalDomain } from "@/lib/development/age-band";

export interface DevelopmentalItemRow {
  id: string;
  domain: DevelopmentalDomain;
  prompt: string;
  display_order: number;
}

export function developmentalItemsKey(ageBandMin: number, ageBandMax: number) {
  return ["developmental-items", ageBandMin, ageBandMax] as const;
}

export function useDevelopmentalItems(ageBand: { min: number; max: number } | null) {
  return useQuery({
    queryKey: ageBand ? developmentalItemsKey(ageBand.min, ageBand.max) : ["developmental-items", "none"],
    queryFn: async (): Promise<DevelopmentalItemRow[]> => {
      if (!ageBand) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("developmental_questionnaire_items")
        .select("id, domain, prompt, display_order")
        .eq("age_band_months_min", ageBand.min)
        .eq("age_band_months_max", ageBand.max)
        .eq("is_active", true)
        .order("domain")
        .order("display_order");
      if (error) throw error;
      return data;
    },
    enabled: !!ageBand,
  });
}

export interface DevelopmentalScreeningRow {
  id: string;
  screening_date: string;
  age_months_at_screening: number;
  domain_scores: Record<string, number> | null;
  flagged_domains: DevelopmentalDomain[];
  overall_flag: boolean;
}

export function developmentalScreeningsKey(patientId: string) {
  return ["developmental-screenings", patientId] as const;
}

export function useDevelopmentalScreenings(patientId: string) {
  return useQuery({
    queryKey: developmentalScreeningsKey(patientId),
    queryFn: async (): Promise<DevelopmentalScreeningRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("developmental_screenings")
        .select("id, screening_date, age_months_at_screening, domain_scores, flagged_domains, overall_flag")
        .eq("patient_id", patientId)
        .order("screening_date", { ascending: false });
      if (error) throw error;
      // domain_scores/flagged_domains are jsonb/enum-array columns typed
      // broadly as Json by the generated client; private.score_developmental_screening
      // always writes them as a flat {domain: number} object (or {} — never
      // any other JSON shape), so this narrows what the DB actually stores.
      return data as unknown as DevelopmentalScreeningRow[];
    },
    enabled: !!patientId,
  });
}

export interface SubmitDevelopmentalScreeningInput {
  patientId: string;
  organisationId: string;
  /** {item_id: 'yes'|'sometimes'|'not_yet'} */
  responses: Record<string, "yes" | "sometimes" | "not_yet">;
}

/** age_months_at_screening, age_band_months_min/max, domain_scores,
 * flagged_domains, and overall_flag are ALL computed server-side by
 * private.score_developmental_screening from the patient's own
 * date_of_birth — see 20260829122052_pediatric_developmental_screening.sql.
 * This mutation only ever sends the raw responses; anything else in the
 * insert payload would just be overwritten. */
export function useSubmitDevelopmentalScreening() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitDevelopmentalScreeningInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("developmental_screenings").insert({
        patient_id: input.patientId,
        organisation_id: input.organisationId,
        responses: input.responses,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: developmentalScreeningsKey(variables.patientId) });
    },
  });
}
