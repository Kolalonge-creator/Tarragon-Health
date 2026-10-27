import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** The patient's most recent video consultations, for the deterministic pre-visit brief. RLS-gated like every other chart read. */
export function usePreVisitConsultations(patientId: string) {
  return useQuery({
    queryKey: ["previsit-consultations", patientId],
    enabled: !!patientId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("video_consultations")
        .select("id, status, scheduled_at, ended_at, context")
        .eq("patient_id", patientId)
        .order("scheduled_at", { ascending: false, nullsFirst: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });
}
