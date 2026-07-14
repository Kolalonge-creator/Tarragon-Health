import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useSymptomLogs(patientId: string) {
  return useQuery({
    queryKey: ["symptom-logs", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("symptoms")
        .select("*")
        .eq("patient_id", patientId)
        .order("reported_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
