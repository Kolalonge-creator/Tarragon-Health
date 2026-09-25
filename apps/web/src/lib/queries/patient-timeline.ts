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
 * itself. doctor_tier is included so the UI can run isClinicalTier
 * (lib/clinical/doctor-tier.ts) before ever showing "Dr." — see
 * ActorAttribution in components/patient-timeline.tsx.
 */
export type TimelineEvent = Tables<"patient_timeline"> & {
  actor: {
    id: string;
    full_name: string | null;
    doctor_tier: Enums<"doctor_tier"> | null;
  } | null;
};

type TimelineActor = NonNullable<TimelineEvent["actor"]>;

/**
 * `actor_clinical_staff_id` used to be embedded directly via
 * `clinical_staff!patient_timeline_actor_clinical_staff_id_fkey(...)` — a
 * PostgREST embedded join, which resolves against `clinical_staff`'s OWN RLS,
 * not this query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would silently
 * come back null for every patient viewing their own timeline. Fetching the
 * actor separately from public.clinical_staff_directory (the safe-column
 * view every patient-facing clinical_staff read now uses) restores the same
 * attribution without reopening the column-exposure gap that migration
 * fixed.
 */
async function fetchTimelineActors(
  supabase: ReturnType<typeof createClient>,
  actorIds: string[]
): Promise<Map<string, TimelineActor>> {
  const actorById = new Map<string, TimelineActor>();
  if (actorIds.length === 0) return actorById;
  const { data, error } = await supabase
    .from("clinical_staff_directory")
    .select("id, full_name, doctor_tier")
    .in("id", actorIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    actorById.set(row.id, {
      id: row.id,
      full_name: row.full_name,
      doctor_tier: row.doctor_tier,
    });
  }
  return actorById;
}

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
export async function loadPatientTimeline(
  supabase: ReturnType<typeof createClient>,
  patientId: string,
  limit: number,
  offset: number
): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from("patient_timeline")
    .select("*")
    .eq("patient_id", patientId)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const actorIds = Array.from(
    new Set((data ?? []).map((row) => row.actor_clinical_staff_id).filter((id): id is string => !!id))
  );
  const actorById = await fetchTimelineActors(supabase, actorIds);

  return (data ?? []).map((row) => ({
    ...row,
    actor: row.actor_clinical_staff_id ? (actorById.get(row.actor_clinical_staff_id) ?? null) : null,
  })) as TimelineEvent[];
}

export function usePatientTimeline(patientId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: ["patient-timeline", patientId, limit, offset],
    queryFn: async () => {
      const supabase = createClient();
      return loadPatientTimeline(supabase, patientId, limit, offset);
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
