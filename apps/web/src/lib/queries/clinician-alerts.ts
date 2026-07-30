import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { compareAlerts } from "@/lib/worklist/priority";
import type { EscalationLevel, Tables } from "@tarragon/shared";

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

/**
 * Records a clinician's disagreement with the system's own deterministic
 * classification (clinician_alerts.level) — never overwrites `level`
 * itself, only the separate override_* fields. Server derives
 * overridden_by/overridden_at from the caller's own active clinical_staff
 * row (private.enforce_alert_override_clinical_only) — passing them here
 * is a no-op, the trigger always recomputes them.
 */
export function useOverrideAlertLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      alertId,
      overrideLevel,
      overrideReason,
    }: {
      alertId: string;
      overrideLevel: EscalationLevel;
      overrideReason: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinician_alerts")
        .update({ override_level: overrideLevel, override_reason: overrideReason })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

/** Clears a previously-set override, reverting display to the system's own classification. */
export function useClearAlertOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinician_alerts")
        .update({ override_level: null })
        .eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
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
