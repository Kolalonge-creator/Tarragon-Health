import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { readPatientVitalsOrThrow, type VitalsRow } from "@/lib/clinical/vitals-audited";

const DAY_MS = 86_400_000;

export interface PreVisitVitals {
  bloodPressure: VitalsRow[];
  glucose: VitalsRow[];
}

/**
 * Blood pressure and glucose readings for the pre-visit brief, each fetched by type for the brief's own window with the brief's own
 * row limit (`copilot.previsit_brief_rules`: windowDays, maxReadingsRead). Not the newest-20-of-everything list other screens use: that
 * mixes types and can hold three weight readings and one BP. Each read goes through the audited, tie-gated function (INV-10); a refusal
 * on either throws, so it reads "not available to you", never "no readings". The brief itself decides whether a result was cut off
 * (it was, when a type returns as many rows as the limit).
 */
export function usePreVisitVitals(patientId: string, windowDays: number, limit: number) {
  return useQuery({
    queryKey: ["previsit-vitals", patientId, windowDays, limit],
    enabled: !!patientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<PreVisitVitals> => {
      const supabase = createClient();
      const since = new Date(Date.now() - windowDays * DAY_MS).toISOString();
      const [bloodPressure, glucose] = await Promise.all([
        readPatientVitalsOrThrow(supabase, patientId, { vitalType: "blood_pressure", since, limit }),
        readPatientVitalsOrThrow(supabase, patientId, { vitalType: "glucose", since, limit }),
      ]);
      return { bloodPressure, glucose };
    },
  });
}
