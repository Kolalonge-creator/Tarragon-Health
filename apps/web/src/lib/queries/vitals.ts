import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useVitalsReadings(patientId: string) {
  return useQuery({
    queryKey: ["vitals-readings", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select("*")
        .eq("patient_id", patientId)
        .order("taken_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
