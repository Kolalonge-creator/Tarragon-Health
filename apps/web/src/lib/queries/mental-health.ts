"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { readPatientMentalHealthOrThrow, type MentalHealthPayload, type MentalHealthScreenRow } from "@/lib/clinical/mental-health-audited";

export type MentalHealthScreen = MentalHealthScreenRow;

export const mentalHealthKey = (patientId: string) => ["mental-health-screens", patientId];

type Bundle = { screens: MentalHealthScreen[]; handoffs: NonNullable<MentalHealthPayload["handoffs"]> };

async function fetchBundle(patientId: string): Promise<Bundle> {
  const supabase = createClient();
  const data = await readPatientMentalHealthOrThrow(supabase, patientId, { sections: ["screens", "handoffs"], limit: 200 });
  return { screens: data.screens ?? [], handoffs: data.handoffs ?? [] };
}

const bundleKey = (patientId: string) => [...mentalHealthKey(patientId), "bundle"] as const;

/**
 * A patient's screens (newest first) and hand-offs, read through the audited function (S56): the patient reads their own record with no
 * audit row; a clinician needs a tie to the patient or break-glass and every read is audited. A refusal throws, so the caller shows
 * "not available" rather than "no screens". One fetch serves all three hooks below (same key), so a clinician opening the chart writes
 * one audit row, not three.
 */
export function useMentalHealthScreenHistory(patientId: string) {
  return useQuery({ queryKey: bundleKey(patientId), queryFn: () => fetchBundle(patientId), retry: false, select: (b) => b.screens });
}

/** Hand-offs the patient sent to the care team (function 10.13). */
export function useMentalHealthHandoffs(patientId: string) {
  return useQuery({ queryKey: bundleKey(patientId), queryFn: () => fetchBundle(patientId), retry: false, select: (b) => b.handoffs });
}

/** The most recent screen per instrument (AHC pathway section 11). */
export function useLatestMentalHealthScreens(patientId: string) {
  return useQuery({
    queryKey: bundleKey(patientId),
    queryFn: () => fetchBundle(patientId),
    retry: false,
    select: (b) => {
      const latest: Partial<Record<string, MentalHealthScreen>> = {};
      for (const row of b.screens) {
        if (!(row.instrument in latest)) latest[row.instrument] = row;
      }
      return latest;
    },
  });
}
