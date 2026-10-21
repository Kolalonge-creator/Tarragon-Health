import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import { readPatientVitalsAudited, readPatientVitalsOrThrow } from "@/lib/clinical/vitals-audited";
import { loadAgpConfig, type AgpSample } from "@/lib/cgm/agp";
import { AGP_READ_LIMIT, AgpReadError } from "@/lib/cgm/agp-read";

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
 * Sensor glucose for the 24 hour profile: the same audited read the vitals chart uses (a staff read writes its audit row). Only sensor sources
 * count, `cgm` and `wearable`, each asked for separately so a few fingerstick readings cannot use up the row limit and give the profile a false
 * shape. A refusal and an outage throw different errors, and a source that returns exactly the limit is reported as `truncated`, never passed off as
 * a complete fortnight. `fetchedAt` is taken here, not in render, so the card never reads the clock while drawing. The 60 second cache is the same
 * as the other vitals hooks: reopening within a minute reuses the read, and the audit row from the first.
 */
export function useAgpReadings(patientId: string) {
  return useQuery({
    queryKey: ["agp-readings", patientId],
    queryFn: async () => {
      const fetchedAt = Date.now();
      const { window_days } = loadAgpConfig().config;
      const since = new Date(fetchedAt - window_days * 24 * 60 * 60 * 1000).toISOString();
      const supabase = createClient();
      const results = await Promise.all(
        (["cgm", "wearable"] as const).map((source) => readPatientVitalsAudited(supabase, patientId, { vitalType: "glucose", since, limit: AGP_READ_LIMIT, source })),
      );
      const samples: AgpSample[] = [];
      let truncated = false;
      for (const r of results) {
        if (r.status === "denied") throw new AgpReadError("denied", "vitals not available to you");
        if (r.status === "error") throw new AgpReadError("error", r.message);
        if (r.rows.length >= AGP_READ_LIMIT) truncated = true;
        for (const row of r.rows) if (row.glucose_mmol_l !== null) samples.push({ takenAt: row.taken_at, mmolL: row.glucose_mmol_l });
      }
      return { samples, fetchedAt, truncated };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!patientId,
  });
}
