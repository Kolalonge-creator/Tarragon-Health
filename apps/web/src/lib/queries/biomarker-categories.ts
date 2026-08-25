import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getBiomarkerCategories } from "@/lib/lab-reports/biomarker-categories";

export function useBiomarkerCategories(patientId: string) {
  return useQuery({
    queryKey: ["biomarker-categories", patientId],
    queryFn: () => getBiomarkerCategories(createClient(), patientId),
    enabled: !!patientId,
  });
}
