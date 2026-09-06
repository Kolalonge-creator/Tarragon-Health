"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type EmergencyContraceptionRequest = Tables<"emergency_contraception_requests">;

/** A pending request plus the (null-gated) patient identity — clinician
 * fast-track worklist row shape (spec §47.8). */
export type EcRequestWithPatient = EmergencyContraceptionRequest & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

const EC_WITH_PATIENT_SELECT =
  "*, patient:profiles!emergency_contraception_requests_patient_id_fkey(full_name, patient_number)";

export const orgPendingEcRequestsKey = ["emergency-contraception-requests", "org", "pending"];

/**
 * Every pending emergency contraception request across the caller's org
 * (clinician fast-track worklist, spec §47.8) — oldest first, since each
 * carries a 1-hour SLA from requested_at, so the longest-waiting request is
 * the most urgent to act on. RLS (is_org_staff) does the org scoping.
 *
 * refetchInterval keeps the SLA badges honest without a manual reload — a
 * short-SLA queue like this one is exactly the case a stale client-side
 * "elapsed time" calculation would otherwise quietly under-report.
 */
export function useOrgPendingEcRequests() {
  return useQuery({
    queryKey: orgPendingEcRequestsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("emergency_contraception_requests")
        .select(EC_WITH_PATIENT_SELECT)
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data as unknown as EcRequestWithPatient[];
    },
    refetchInterval: 60_000,
  });
}
