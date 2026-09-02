import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type TimelineEventType = Enums<"timeline_event_type">;

/**
 * A patient_timeline row plus the (null-gated) acting staff member. `actor` is
 * only ever a real public.clinical_staff row — the FK guarantees it — but a
 * real row is NOT the same as a real doctor: a Care Coordinator carries an
 * active clinical_staff row too (doctor_tier = 'care_coordinator'), so
 * rendering "Dr. X" from a non-null actor alone is not attribution-safe by
 * itself. doctor_tier + is_clinical_director are included so the UI can run
 * isClinicalTier (lib/clinical/doctor-tier.ts) before ever showing "Dr." —
 * see ActorAttribution in components/patient-timeline.tsx.
 */
export type TimelineEvent = Tables<"patient_timeline"> & {
  actor: {
    full_name: string | null;
    credential_type: string | null;
    credential_number: string | null;
    doctor_tier: Enums<"doctor_tier"> | null;
    is_clinical_director: boolean;
  } | null;
};

const TIMELINE_SELECT =
  "*, actor:clinical_staff!patient_timeline_actor_clinical_staff_id_fkey(full_name, credential_type, credential_number, doctor_tier, is_clinical_director)";

/**
 * The unified activity feed for a single patient, newest first. Read by the
 * patient dashboard, the clinician patient-detail view, and (since the
 * 2026-07-30 proof_log gap closure) any profile_access grantee — RLS
 * (patient_id = auth.uid() OR is_org_staff(organisation_id) OR a matching
 * profile_access row) is what scopes each caller to what they may see, so the
 * same query is safe everywhere. No UI currently renders this for a grantee
 * viewing someone else's timeline — the capability exists at the data layer
 * ahead of any consuming surface.
 *
 * `offset` defaults to 0, preserving every existing 2-arg call site exactly
 * (Overview's `limit={6}` preview, the clinician views' own PatientTimeline
 * usages). It exists for the full-history page (/patient/timeline), whose
 * client wrapper instead grows `limit` on each "Load more" click rather than
 * paging via `offset` — see timeline-client.tsx — but `.range()` is still the
 * right offset-pagination primitive to expose here for any future caller
 * that does want true offset paging.
 */
export function usePatientTimeline(patientId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["patient-timeline", patientId, limit, offset],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_timeline")
        .select(TIMELINE_SELECT)
        .eq("patient_id", patientId)
        .order("occurred_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      // The embedded actor alias defeats the generated row typing; the runtime
      // shape matches TimelineEvent.
      return data as unknown as TimelineEvent[];
    },
    enabled: !!patientId,
    // A growing `limit` (the full-history page's pagination strategy) changes
    // the queryKey on every "Load more" click, which would otherwise drop
    // back to a loading state and blank the already-rendered list for a
    // moment. Keeping the previous page's data on screen while the larger
    // page loads makes that feel like an append, not a reset.
    placeholderData: keepPreviousData,
  });
}
