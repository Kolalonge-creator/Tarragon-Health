import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

export type HospitalAdmission =
  Database["public"]["Tables"]["patient_hospital_admissions"]["Row"];

export const hospitalAdmissionsKey = (patientId: string) => [
  "hospital-admissions",
  patientId,
];
// Prefix of the unified append-only PatientTimeline key (@/lib/queries/patient-timeline);
// invalidating this refreshes that feed when a new admission lands.
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
