import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { attachMedicationEmbeds } from "@/lib/clinical/medications-audited";
import type { Tables } from "@tarragon/shared";

export type MedicationLabMonitoring = Tables<"medication_lab_monitoring">;

export type LabMonitoringWithDrug = MedicationLabMonitoring & {
  medication: { drug_name: string } | null;
};

/**
 * A patient's pending, drug-triggered lab monitoring (Phase 7) — dated items
 * first (soonest due), then "as clinically indicated" ones. Powers both a
 * standalone card and the "next lab" line in the medicines cabinet (Phase 3).
 */
export function usePatientLabMonitoring(patientId: string) {
  return useQuery({
    queryKey: ["lab-monitoring", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_lab_monitoring")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      // INV-10: the medication name comes from the audited read, not an embedded select of the closed table.
      return (await attachMedicationEmbeds(supabase, data)) as LabMonitoringWithDrug[];
    },
    enabled: !!patientId,
  });
}
