import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

export type HospitalAdmission =
  Database["public"]["Tables"]["patient_hospital_admissions"]["Row"];
export type TimelineEvent = Database["public"]["Views"]["patient_timeline"]["Row"];

export const hospitalAdmissionsKey = (patientId: string) => [
  "hospital-admissions",
  patientId,
];
export const patientTimelineKey = (patientId: string) => ["patient-timeline", patientId];

/** The patient's own hospital admissions, most recent first. */
export function usePatientAdmissions(patientId: string) {
  return useQuery({
    queryKey: hospitalAdmissionsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_hospital_admissions")
        .select("*")
        .eq("patient_id", patientId)
        .order("admitted_on", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

/**
 * The unified patient timeline — a security_invoker view union of the patient's
 * vitals, symptoms, labs, emergencies, care plans, medications, and hospital
 * admissions. RLS on the underlying tables is what scopes it.
 */
export function usePatientTimeline(patientId: string, limit = 30) {
  return useQuery({
    queryKey: patientTimelineKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_timeline")
        .select("*")
        .eq("patient_id", patientId)
        .order("event_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
