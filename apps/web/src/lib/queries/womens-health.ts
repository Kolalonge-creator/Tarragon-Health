import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AntenatalVisit = Tables<"antenatal_visits">;
export type PostnatalProfile = Tables<"postnatal_profiles">;
export type PostnatalCheckin = Tables<"postnatal_checkins">;
export type BreastSymptomReport = Tables<"breast_symptom_reports">;
export type MenopauseSymptomLog = Tables<"menopause_symptom_logs">;
export type FertilityAssessmentRequest = Tables<"fertility_assessment_requests">;

/**
 * Read hooks for the Women's Health platform (§44). Same shape as
 * lib/queries/reproductive-health.ts: writes go through server actions
 * (womens-health-actions.ts), whose useActionState success callback
 * invalidates the matching query key here — see danger-symptom-check.tsx for
 * the pattern this follows.
 */

export function antenatalVisitsKey(patientId: string) {
  return ["antenatal-visits", patientId];
}

export function useAntenatalVisits(patientId: string) {
  return useQuery({
    queryKey: antenatalVisitsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("antenatal_visits")
        .select("*")
        .eq("patient_id", patientId)
        .order("gestational_week_at_visit", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as AntenatalVisit[];
    },
    enabled: !!patientId,
  });
}

export function postnatalProfilesKey(patientId: string) {
  return ["postnatal-profiles", patientId];
}

export function usePostnatalProfiles(patientId: string) {
  return useQuery({
    queryKey: postnatalProfilesKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("postnatal_profiles")
        .select("*")
        .eq("patient_id", patientId)
        .order("delivery_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PostnatalProfile[];
    },
    enabled: !!patientId,
  });
}

export function postnatalCheckinsKey(postnatalProfileId: string) {
  return ["postnatal-checkins", postnatalProfileId];
}

export function usePostnatalCheckins(postnatalProfileId: string) {
  return useQuery({
    queryKey: postnatalCheckinsKey(postnatalProfileId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("postnatal_checkins")
        .select("*")
        .eq("postnatal_profile_id", postnatalProfileId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PostnatalCheckin[];
    },
    enabled: !!postnatalProfileId,
  });
}

export function breastSymptomReportsKey(patientId: string) {
  return ["breast-symptom-reports", patientId];
}

export function useBreastSymptomReports(patientId: string) {
  return useQuery({
    queryKey: breastSymptomReportsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("breast_symptom_reports")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BreastSymptomReport[];
    },
    enabled: !!patientId,
  });
}

export function menopauseSymptomLogsKey(patientId: string) {
  return ["menopause-symptom-logs", patientId];
}

export function useMenopauseSymptomLogs(patientId: string) {
  return useQuery({
    queryKey: menopauseSymptomLogsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("menopause_symptom_logs")
        .select("*")
        .eq("patient_id", patientId)
        .order("logged_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as MenopauseSymptomLog[];
    },
    enabled: !!patientId,
  });
}

export function fertilityAssessmentRequestsKey(patientId: string) {
  return ["fertility-assessment-requests", patientId];
}

export function useFertilityAssessmentRequests(patientId: string) {
  return useQuery({
    queryKey: fertilityAssessmentRequestsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("fertility_assessment_requests")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FertilityAssessmentRequest[];
    },
    enabled: !!patientId,
  });
}

/** Invalidates every Women's Health query key for a patient in one call —
 * used after a server action succeeds, same pattern as
 * danger-symptom-check.tsx's single-key invalidate. */
export function useInvalidateWomensHealth(patientId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: antenatalVisitsKey(patientId) });
    void queryClient.invalidateQueries({ queryKey: postnatalProfilesKey(patientId) });
    void queryClient.invalidateQueries({ queryKey: breastSymptomReportsKey(patientId) });
    void queryClient.invalidateQueries({ queryKey: menopauseSymptomLogsKey(patientId) });
    void queryClient.invalidateQueries({ queryKey: fertilityAssessmentRequestsKey(patientId) });
  };
}
