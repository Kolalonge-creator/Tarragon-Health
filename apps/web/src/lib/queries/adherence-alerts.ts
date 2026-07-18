import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AdherenceAlert = Tables<"medication_adherence_alerts">;

export type AdherenceAlertWithContext = AdherenceAlert & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  medication: { drug_name: string } | null;
};

const ALERT_SELECT =
  "*, patient:profiles!medication_adherence_alerts_patient_id_fkey(full_name, patient_number), medication:medications!medication_adherence_alerts_medication_id_fkey(drug_name)";

/**
 * Care-team adherence worklist — unresolved missed-dose alerts, doctor-level
 * first then soonest-raised. RLS (private.is_org_staff) scopes to the org.
 */
export function useOrgAdherenceAlerts() {
  return useQuery({
    queryKey: ["adherence-alerts", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_adherence_alerts")
        .select(ALERT_SELECT)
        .neq("status", "resolved")
        .order("level", { ascending: false }) // 'doctor' > 'coach' lexically
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as AdherenceAlertWithContext[];
    },
  });
}

/**
 * Acknowledge or resolve an alert. acknowledged_by/resolved_by are stamped
 * server-side from the caller's clinical_staff row — never sent from here.
 */
export function useUpdateAdherenceAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      alertId,
      status,
      resolutionNote,
    }: {
      alertId: string;
      status: "acknowledged" | "resolved";
      resolutionNote?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_adherence_alerts")
        .update({
          status,
          ...(status === "resolved" ? { resolution_note: resolutionNote ?? null } : {}),
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adherence-alerts", "org"] });
    },
  });
}
