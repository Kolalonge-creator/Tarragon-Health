import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CgmConnection = Tables<"cgm_connections">;
export type CgmPartner = Tables<"cgm_partners">;

/** The caller's CGM connections (RLS-scoped), newest first. */
export function useCgmConnections(patientId: string) {
  return useQuery({
    queryKey: ["cgm-connections", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("cgm_connections")
        .select("*")
        .eq("patient_id", patientId)
        .order("connected_at", { ascending: false });
      if (error) throw error;
      return data as CgmConnection[];
    },
    enabled: !!patientId,
  });
}

/** Active CGM partners. RLS only returns is_active rows to non-admins, so this
 * is empty until ops onboards + activates a real partner (the dormant gate). */
export function useActiveCgmPartners() {
  return useQuery({
    queryKey: ["cgm-partners-active"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("cgm_partners")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data as CgmPartner[];
    },
  });
}

export interface CgmReading {
  glucose_mmol_l: number | null;
  taken_at: string;
}

/** Recent CGM glucose readings for a patient — display-only time-in-range input. */
export function useCgmReadings(patientId: string, days = 14) {
  return useQuery({
    queryKey: ["cgm-readings", patientId, days],
    queryFn: async () => {
      const supabase = createClient();
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("vitals_readings")
        .select("glucose_mmol_l, taken_at")
        .eq("patient_id", patientId)
        .eq("source", "cgm")
        .gte("taken_at", cutoff)
        .order("taken_at", { ascending: false });
      if (error) throw error;
      return data as CgmReading[];
    },
    enabled: !!patientId,
  });
}
