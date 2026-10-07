import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { LifecycleKind, LifecycleStage, TrackerDeletionScope } from "@tarragon/shared";

/** S68 (Module 16, postnatal and child). Plain RLS-scoped calls: no service-role client, no new access shape. Writes of a stage go through
 * the record_lifecycle_event function only; deletion goes through request/complete_tracker_deletion only. */

export type FeedLogRow = Tables<"breastfeeding_feed_log">;
export type BabyCheckRow = Tables<"postnatal_baby_checks">;
export type TrackerDeletionRow = Tables<"tracker_deletion_requests">;

export interface MyLifecycle {
  stage: LifecycleStage;
  stage_since: string | null;
  content_set: string;
  bp_rule_set: string | null;
  baby_content_hidden: boolean;
}

export const lifecycleKey = ["my-lifecycle"] as const;

export function useMyLifecycle() {
  return useQuery({
    queryKey: lifecycleKey,
    queryFn: async (): Promise<MyLifecycle | null> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("my_lifecycle");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as MyLifecycle | null;
    },
  });
}

export function useRecordLifecycleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: LifecycleKind; occurredOn: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("record_lifecycle_event", { p_kind: input.kind, p_occurred_on: input.occurredOn });
      if (error) throw new Error(error.code === "55000" ? "not_open" : error.code === "22023" ? "unavailable" : "failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: lifecycleKey }),
  });
}

export const feedLogKey = (patientId: string) => ["feed-log", patientId] as const;

export function useFeedLog(patientId: string) {
  return useQuery({
    queryKey: feedLogKey(patientId),
    queryFn: async (): Promise<FeedLogRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.from("breastfeeding_feed_log").select("*").eq("patient_id", patientId).order("fed_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useLogFeed(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { organisationId: string; feedType: FeedLogRow["feed_type"]; durationMinutes: number | null; amountMl: number | null }) => {
      const supabase = createClient();
      const { error } = await supabase.from("breastfeeding_feed_log").insert({
        patient_id: patientId,
        organisation_id: input.organisationId,
        feed_type: input.feedType,
        duration_minutes: input.durationMinutes,
        amount_ml: input.amountMl,
      });
      if (error) throw new Error(error.code === "55000" ? "not_open" : "failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feedLogKey(patientId) }),
  });
}

export const babyChecksKey = (patientId: string) => ["baby-checks", patientId] as const;

export function useBabyChecks(patientId: string) {
  return useQuery({
    queryKey: babyChecksKey(patientId),
    queryFn: async (): Promise<BabyCheckRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.from("postnatal_baby_checks").select("*").eq("patient_id", patientId).order("scheduled_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useSaveBabyCheck(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; weightKg: number | null; feedingMethod: BabyCheckRow["feeding_method"]; concernsNoted: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("postnatal_baby_checks")
        .update({ completed_at: new Date().toISOString(), baby_weight_kg: input.weightKg, feeding_method: input.feedingMethod, concerns_noted: input.concernsNoted })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: babyChecksKey(patientId) }),
  });
}

export const deletionKey = (patientId: string) => ["tracker-deletions", patientId] as const;

export function useTrackerDeletions(patientId: string) {
  return useQuery({
    queryKey: deletionKey(patientId),
    queryFn: async (): Promise<TrackerDeletionRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.from("tracker_deletion_requests").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useTrackerDeletionActions(patientId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: deletionKey(patientId) });
  return {
    request: useMutation({
      mutationFn: async (input: { scope: TrackerDeletionScope; subject?: string }) => {
        const supabase = createClient();
        const { error } = await supabase.rpc("request_tracker_deletion", { p_scope: input.scope, p_patient: input.subject });
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: async (id: string) => {
        const supabase = createClient();
        const { error } = await supabase.rpc("cancel_tracker_deletion", { p_id: id });
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
    complete: useMutation({
      mutationFn: async (id: string) => {
        const supabase = createClient();
        const { error } = await supabase.rpc("complete_tracker_deletion", { p_id: id });
        if (error) throw error;
      },
      onSuccess: refresh,
    }),
  };
}
