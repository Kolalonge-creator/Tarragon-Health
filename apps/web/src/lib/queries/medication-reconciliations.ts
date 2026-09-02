import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type MedicationReconciliation = Tables<"medication_reconciliations">;

function reconciliationKey(patientId: string) {
  return ["medication-reconciliations", patientId];
}

/**
 * The patient's own most recent OPEN reconciliation episode (not yet
 * reconciled), if any — null means there's nothing awaiting either the
 * patient's confirmation or a clinician's reconciliation right now.
 */
export function useOpenMedicationReconciliation(patientId: string) {
  return useQuery({
    queryKey: reconciliationKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_reconciliations")
        .select("*")
        .eq("patient_id", patientId)
        .is("reconciled_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as MedicationReconciliation | null;
    },
    enabled: !!patientId,
  });
}

/**
 * Medication safety pathway 64.3, step 1 — "Patient confirms". Opens a new
 * reconciliation episode (server-snapshots the active list, see
 * private.snapshot_medication_reconciliation_list) and immediately confirms
 * it in the same action, or confirms an existing clinician-opened episode
 * if one is already pending.
 */
export function useConfirmMedicationList(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      existingId,
      note,
    }: {
      existingId: string | null;
      note: string | null;
    }) => {
      const supabase = createClient();

      if (existingId) {
        const { error } = await supabase
          .from("medication_reconciliations")
          .update({ patient_confirmed_at: new Date().toISOString(), patient_note: note })
          .eq("id", existingId);
        if (error) throw error;
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) throw new Error("This patient has no organisation on file");

      const { data: inserted, error: insertError } = await supabase
        .from("medication_reconciliations")
        .insert({ organisation_id: profile.organisation_id, patient_id: patientId })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const { error: updateError } = await supabase
        .from("medication_reconciliations")
        .update({ patient_confirmed_at: new Date().toISOString(), patient_note: note })
        .eq("id", inserted.id);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKey(patientId) });
    },
  });
}

/**
 * Medication safety pathway 64.3, step 2 — "Clinician reconciles". Only
 * succeeds once the patient has confirmed (private.stamp_medication_
 * reconciliation_transition enforces the ordering) and the caller is
 * clinical-tier (private.is_clinical_tier) — a Care Coordinator can open an
 * episode and collect the patient's confirmation but cannot reconcile it.
 */
export function useReconcileMedicationList(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_reconciliations")
        .update({ reconciled_at: new Date().toISOString(), reconciliation_note: note })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reconciliationKey(patientId) });
    },
  });
}
