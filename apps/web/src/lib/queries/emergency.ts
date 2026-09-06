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
        // clinician_alert_id is the per-event record of whether a
        // clinician_alerts row was actually raised for this emergency.
        // private.handle_emergency_event only sets it when the patient holds
        // the vitals_red_flag_doctor_escalation entitlement; on the free tier
        // it stays null and nobody is paged. The dialog reads it so it never
        // tells a patient mid-emergency that their care team has been
        // notified when no clinician has been.
        .select("id, source, trigger_detail, created_at, contact_notified_at, clinician_alert_id")
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
