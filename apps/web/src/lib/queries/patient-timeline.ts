import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type TimelineEventType = Enums<"timeline_event_type">;

/**
 * A patient_timeline row plus the (null-gated) acting clinician. `actor` is only
 * ever a real public.clinical_staff row — the FK guarantees it — so any
 * "Reviewed by Dr X" line the UI renders from it is attribution-safe per
 * docs/CLINICAL_TRUST_MODEL_SPEC.md. When actor_clinical_staff_id is null there
 * is no attribution to show.
 */
export type TimelineEvent = Tables<"patient_timeline"> & {
  actor: {
    full_name: string | null;
    credential_type: string | null;
    credential_number: string | null;
  } | null;
};

const TIMELINE_SELECT =
  "*, actor:clinical_staff!patient_timeline_actor_clinical_staff_id_fkey(full_name, credential_type, credential_number)";

/**
 * The unified activity feed for a single patient, newest first. Read by both the
 * patient dashboard and the clinician patient-detail view — RLS
 * (patient_id = auth.uid() OR private.is_org_staff(organisation_id)) is what
 * scopes each caller to what they may see, so the same query is safe on both.
 */
export function usePatientTimeline(patientId: string, limit = 50) {
  return useQuery({
    queryKey: ["patient-timeline", patientId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_timeline")
        .select(TIMELINE_SELECT)
        .eq("patient_id", patientId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      // The embedded actor alias defeats the generated row typing; the runtime
      // shape matches TimelineEvent.
      return data as unknown as TimelineEvent[];
    },
    enabled: !!patientId,
  });
}
