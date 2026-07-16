import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export const activeEmergencyKey = (patientId: string) => ["active-emergency", patientId];

/**
 * The patient's most recent un-acknowledged, active emergency event, if any.
 * Drives the site-wide EmergencyAlert dialog. Polls on a short interval so an
 * event raised by another path (symptom log, AI coach, a clinician) surfaces
 * without a manual reload.
 */
export function useActiveEmergency(patientId: string) {
  return useQuery({
    queryKey: activeEmergencyKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("emergency_events")
        .select("id, source, trigger_detail, created_at, contact_notified_at")
        .eq("patient_id", patientId)
        .eq("status", "active")
        .is("acknowledged_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
    refetchInterval: 30_000,
  });
}
