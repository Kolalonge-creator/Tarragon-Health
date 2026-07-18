import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { compareAlerts } from "@/lib/worklist/priority";
import type { Tables } from "@tarragon/shared";

export type ClinicianAlertWithPatient = Tables<"clinician_alerts"> & {
  patient: { full_name: string | null } | null;
};

export function useClinicianAlerts() {
  return useQuery({
    queryKey: ["clinician-alerts", "open"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinician_alerts")
        .select("*, patient:profiles!clinician_alerts_patient_id_fkey(full_name)")
        .eq("status", "open")
        .order("sla_due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data as ClinicianAlertWithPatient[]).slice().sort(compareAlerts);
    },
    refetchInterval: 60_000,
  });
}

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("clinician_alerts")
        .update({
          status: "acknowledged",
          acknowledged_by: user.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts", "open"] });
    },
  });
}
