import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

/**
 * Learning Centre (S55, Module 9). Search with the synonym table, the trust and "What can I do next?" facts
 * for an item, the daily micro-lesson card, "ask your care team" saves, and the admin creator/report reads.
 * Every call is an RLS-scoped or SECURITY DEFINER RPC that applies the review-date rule on the server; nothing
 * here decides what is servable.
 */
type Fn = Database["public"]["Functions"];
export type LearningSearchHit = Fn["search_health_education"]["Returns"][number];
export type LearningItemTrust = Fn["health_education_item_trust"]["Returns"][number];
export type DailyMicroLesson = Fn["daily_micro_lesson"]["Returns"][number];
export type LearningSearchGap = Fn["learning_search_gaps_report"]["Returns"][number];
export type LearningReadinessRow = Fn["learning_readiness_report"]["Returns"][number];

export function useSearchHealthEducation(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["learning-search", q] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("search_health_education", { p_query: q, p_limit: 20 });
      if (error) throw error;
      return (data ?? []) as LearningSearchHit[];
    },
    enabled: q.length >= 2,
    staleTime: 60_000,
    // A zero-result search is written to the planning log, so a silent refetch (window focus, reconnect) would count the same
    // person's one search again and push a phrase over the admin threshold on its own.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useHealthEducationItemTrust(code: string) {
  return useQuery({
    queryKey: ["learning-trust", code] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_item_trust", { p_codes: [code] });
      if (error) throw error;
      return ((data ?? []) as LearningItemTrust[])[0] ?? null;
    },
    enabled: !!code,
  });
}

export const dailyLessonKey = (patientId: string) => ["learning-daily-lesson", patientId] as const;

export function useDailyMicroLesson(patientId: string) {
  return useQuery({
    queryKey: dailyLessonKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("daily_micro_lesson");
      if (error) throw error;
      return ((data ?? []) as DailyMicroLesson[])[0] ?? null;
    },
    enabled: !!patientId,
  });
}

/** "Ask your care team about this": saves the lesson to the next consultation. Returns false when it cannot be saved (not servable). */
export function useSaveLessonForConsultation() {
  return useMutation({
    mutationFn: async (code: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("save_lesson_for_consultation", { p_code: code });
      if (error) throw error;
      return data === true;
    },
  });
}

// ---------------------------------------------------------------------------
// Admin: creators, search gaps, readiness
// ---------------------------------------------------------------------------
export type LearningCreator = Database["public"]["Tables"]["learning_creators"]["Row"];
export const learningCreatorsKey = ["learning-creators"] as const;

export function useLearningCreators() {
  return useQuery({
    queryKey: learningCreatorsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("learning_creators").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LearningCreator[];
    },
  });
}

export function useInviteLearningCreator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, displayName }: { profileId: string; displayName: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("invite_learning_creator", { p_profile: profileId, p_display_name: displayName });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: learningCreatorsKey }),
  });
}

export function useVerifyLearningCreator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("verify_learning_creator", { p_id: id, p_note: note });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: learningCreatorsKey }),
  });
}

export function useSuspendLearningCreator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, decline }: { id: string; reason: string; decline?: boolean }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("suspend_learning_creator", { p_id: id, p_reason: reason, p_decline: decline ?? false });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: learningCreatorsKey }),
  });
}

export function useLearningSearchGaps() {
  return useQuery({
    queryKey: ["learning-search-gaps"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("learning_search_gaps_report");
      if (error) throw error;
      return (data ?? []) as LearningSearchGap[];
    },
  });
}

export function useLearningReadiness() {
  return useQuery({
    queryKey: ["learning-readiness"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("learning_readiness_report");
      if (error) throw error;
      return (data ?? []) as LearningReadinessRow[];
    },
  });
}

export function useReinstateLearningCreator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("reinstate_learning_creator", { p_id: id, p_note: note });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: learningCreatorsKey }),
  });
}

/** The signed-in clinician's own creator record, if an admin invited them (RLS: they read only their own row). */
export function useMyLearningCreator() {
  return useQuery({
    queryKey: ["learning-creator-me"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("learning_creators").select("*").maybeSingle();
      if (error) throw error;
      return (data ?? null) as LearningCreator | null;
    },
  });
}

export function useSubmitCreatorCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mdcn, evidence, indemnity }: { mdcn: string; evidence: string; indemnity: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_creator_credentials", { p_mdcn: mdcn, p_evidence: evidence, p_indemnity: indemnity });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["learning-creator-me"] }),
  });
}
