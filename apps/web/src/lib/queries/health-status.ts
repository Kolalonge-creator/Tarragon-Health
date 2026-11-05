import { useQuery } from "@tanstack/react-query";
import { buildHealthStatusDomains, type HealthStatusDomain } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";

/**
 * T2-06: health status by domain, the replacement for the composite Health Score. One read of public.patient_health_status(), which
 * applies the same access test as each source table (a caregiver sees only what their category grants allow), turned into domains by
 * the shared, deterministic builder so web and mobile cannot disagree.
 */
export function useHealthStatusDomains(patientId: string) {
  return useQuery({
    queryKey: ["health-status-domains", patientId],
    queryFn: async (): Promise<HealthStatusDomain[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("patient_health_status", { p_patient: patientId });
      if (error) throw error;
      const d = (data ?? {}) as { labs?: unknown; vitals?: unknown; screening?: unknown };
      return buildHealthStatusDomains({ labs: d.labs, vitals: d.vitals, screening: d.screening });
    },
    enabled: !!patientId,
  });
}
