import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { loadAnchors, type LoadedAnchors } from "@/lib/medication-schedule/anchor-profile";
import type { AnchorId } from "@tarragon/medicines";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

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
    mutationFn: async (v: {
      patientId: string;
      /** One id per user action (the form makes it when it opens): a retry or a double click then makes one shift, never two. */
      clientId: string;
      startsOn: string;
      endsOn: string;
      offsets: Partial<Record<AnchorId, number>>;
    }): Promise<string> => {
      const { data, error } = await createClient().rpc("create_day_shift", {
        p_patient: v.patientId,
        p_client_id: v.clientId,
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

/**
 * The opaque slot for each of these anchors, made by the server when missing. A medicine tied to the day stores the SLOT, never the
 * anchor's name: which prayers a person uses discloses religious belief, and a medicine's schedule is read by the care team, caregivers
 * and exports. Returns null when it could not be done.
 */
export async function ensureDoseAnchorSlots(
  supabase: SupabaseClient<Database>,
  patientId: string,
  anchors: readonly AnchorId[]
): Promise<Record<string, string> | null> {
  try {
    const unique = [...new Set(anchors)];
    const { data, error } = await supabase.rpc("ensure_dose_anchor_slots", { p_patient: patientId, p_anchors: unique });
    if (error || data === null || typeof data !== "object" || Array.isArray(data)) return null;
    const map = data as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const a of unique) {
      const slot = map[a];
      if (typeof slot !== "string") return null;
      out[a] = slot;
    }
    return out;
  } catch {
    return null;
  }
}
