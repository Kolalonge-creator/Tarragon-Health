import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import { readPatientVitalsOrThrow } from "@/lib/clinical/vitals-audited";
import { loadAgpConfig, type AgpSample } from "@/lib/cgm/agp";

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
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const rows = await readPatientVitalsOrThrow(createClient(), patientId, { source: "cgm", since: cutoff, limit: 5000 });
      return rows.map((r) => ({ glucose_mmol_l: r.glucose_mmol_l, taken_at: r.taken_at })) as CgmReading[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!patientId,
  });
}

/**
 * Sensor glucose for the 24 hour profile: the same audited read the vitals chart uses (a staff read writes its audit row, a refusal throws and
 * so can never look like "no readings"). Only sensor sources count, `cgm` and `wearable`: a handful of fingerstick readings would give the profile
 * a false shape. `fetchedAt` is taken here, not in render, so the card never reads the clock while drawing.
 */
export function useAgpReadings(patientId: string) {
  return useQuery({
    queryKey: ["agp-readings", patientId],
    queryFn: async () => {
      const fetchedAt = Date.now();
      const { window_days } = loadAgpConfig().config;
      const since = new Date(fetchedAt - window_days * 24 * 60 * 60 * 1000).toISOString();
      const rows = await readPatientVitalsOrThrow(createClient(), patientId, { vitalType: "glucose", since, limit: 5000 });
      const samples: AgpSample[] = [];
      for (const r of rows) {
        if ((r.source === "cgm" || r.source === "wearable") && r.glucose_mmol_l !== null) samples.push({ takenAt: r.taken_at, mmolL: r.glucose_mmol_l });
      }
      return { samples, fetchedAt };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!patientId,
  });
}
