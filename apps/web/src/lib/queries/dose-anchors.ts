import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { loadAnchors, type LoadedAnchors } from "@/lib/medication-schedule/anchor-profile";
import type { AnchorId } from "@tarragon/medicines";

/** The patient's anchor times and day shifts (S08z), for the Today list and the "My day" card. */
export function doseAnchorsKey(patientId: string) {
  return ["dose-anchors", patientId];
}

export function useAnchors(patientId: string) {
  return useQuery<LoadedAnchors>({
    queryKey: doseAnchorsKey(patientId),
    queryFn: () => loadAnchors(createClient(), patientId),
  });
}

/** Saves anchor times. The database returns the first date they apply from: tomorrow when today already has answers on those anchors. */
export function useSaveAnchorTimes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patientId, times }: { patientId: string; times: Partial<Record<AnchorId, string>> }): Promise<string> => {
      const { data, error } = await createClient().rpc("save_dose_anchor_times", { p_patient: patientId, p_times: times });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: doseAnchorsKey(v.patientId) });
      queryClient.invalidateQueries({ queryKey: ["medication-logs"] });
    },
  });
}

export function useCreateDayShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { patientId: string; startsOn: string; endsOn: string; offsets: Partial<Record<AnchorId, number>> }): Promise<string> => {
      const { data, error } = await createClient().rpc("create_day_shift", {
        p_patient: v.patientId,
        // A retry of the same click makes one shift, never two.
        p_client_id: crypto.randomUUID(),
        p_starts_on: v.startsOn,
        p_ends_on: v.endsOn,
        p_offsets: v.offsets,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: doseAnchorsKey(v.patientId) }),
  });
}

export function useEndDayShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patientId, shiftId }: { patientId: string; shiftId: string }): Promise<string> => {
      const { data, error } = await createClient().rpc("cancel_day_shift", { p_patient: patientId, p_id: shiftId });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => queryClient.invalidateQueries({ queryKey: doseAnchorsKey(v.patientId) }),
  });
}
