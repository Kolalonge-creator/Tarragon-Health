"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { LIPID_ANALYTE_CODES, type LipidAnalyteCode } from "@/lib/lipids/analytes";

export type LipidReading = {
  code: LipidAnalyteCode;
  value: number;
  unit: string;
  taken_at: string;
};

export type LipidProfile = {
  /** Most recent value per lipid analyte code (may be partially populated). */
  latest: Partial<Record<LipidAnalyteCode, LipidReading>>;
  /** Full chronological history (ascending) per code, for trend display. */
  history: Record<LipidAnalyteCode, LipidReading[]>;
  latestDrawnAt: string | null;
};

/**
 * Reads a patient's lipid history from `lab_analyte_readings` — the same
 * longitudinal store HbA1c uses. RLS decides visibility: the patient, org
 * staff, or a consent-granted profile_access grantee (family dashboard).
 * Lipids are never a standalone object; this hook just projects the lipid
 * codes out of the shared analyte history.
 */
export function useLipidProfile(patientId: string) {
  return useQuery({
    queryKey: ["lipid-profile", patientId],
    queryFn: async (): Promise<LipidProfile> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_analyte_readings")
        .select("code, value, unit, taken_at")
        .eq("patient_id", patientId)
        .in("code", LIPID_ANALYTE_CODES as unknown as string[])
        .order("taken_at", { ascending: true });
      if (error) throw error;

      const history = Object.fromEntries(
        LIPID_ANALYTE_CODES.map((code) => [code, [] as LipidReading[]])
      ) as Record<LipidAnalyteCode, LipidReading[]>;
      const latest: Partial<Record<LipidAnalyteCode, LipidReading>> = {};
      let latestDrawnAt: string | null = null;

      for (const row of data ?? []) {
        const code = row.code as LipidAnalyteCode;
        if (!history[code]) continue;
        const reading: LipidReading = {
          code,
          value: Number(row.value),
          unit: row.unit,
          taken_at: row.taken_at,
        };
        history[code].push(reading);
        latest[code] = reading; // ascending order → last wins
        if (!latestDrawnAt || row.taken_at > latestDrawnAt) {
          latestDrawnAt = row.taken_at;
        }
      }

      return { latest, history, latestDrawnAt };
    },
    enabled: !!patientId,
  });
}
