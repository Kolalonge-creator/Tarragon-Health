import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ExerciseProgramme = Tables<"exercise_programmes">;
export type ExerciseReadinessScreen = Tables<"exercise_readiness_screens">;
export type ExerciseEnrollment = Tables<"patient_exercise_enrollments">;
export type ExerciseSessionLog = Tables<"exercise_session_logs">;

export function useExerciseProgrammes() {
  return useQuery({
    queryKey: ["exercise-programmes"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("exercise_programmes")
        .select("*")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      return data as ExerciseProgramme[];
    },
  });
}

export function useLatestReadinessScreen(patientId: string) {
  return useQuery({
    queryKey: ["exercise-readiness-screen", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("exercise_readiness_screens")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export function useExerciseEnrollments(patientId: string) {
  return useQuery({
    queryKey: ["exercise-enrollments", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_exercise_enrollments")
        .select("*, programme:exercise_programmes(*)")
        .eq("patient_id", patientId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

/** Whether the given readiness screen clears a patient for a *moderate*
 * programme: no red flags at all, or a clinician has explicitly cleared a
 * flagged one. Mirrors private.enforce_exercise_readiness()'s own logic —
 * this is a read-only UI hint, the DB trigger is the real gate. */
export function clearsForModerate(screen: ExerciseReadinessScreen | null | undefined): boolean {
  if (!screen) return false;
  return !screen.any_flag || screen.cleared_for_intensive;
}

/** A vigorous programme always needs explicit clinician clearance. */
export function clearsForVigorous(screen: ExerciseReadinessScreen | null | undefined): boolean {
  return !!screen?.cleared_for_intensive;
}

const SESSION_PAGE = 1000;
/** A sanity ceiling only (about 14 sessions a day for the 30-day logging window, every day for a year); never reached in practice. */
const SESSION_MAX_PAGES = 20;

/**
 * Every session the person has logged, newest first. Progress, weeks in a row and per-programme totals are counted from this list, so it is read
 * in full (page by page) rather than cut at an arbitrary row count that would quietly shrink the figures.
 */
export function useExerciseSessions(patientId: string) {
  return useQuery({
    queryKey: ["exercise-sessions", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const rows: ExerciseSessionLog[] = [];
      for (let page = 0; page < SESSION_MAX_PAGES; page++) {
        const { data, error } = await supabase
          .from("exercise_session_logs")
          .select("*")
          .eq("patient_id", patientId)
          .order("performed_on", { ascending: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * SESSION_PAGE, (page + 1) * SESSION_PAGE - 1);
        if (error) throw error;
        rows.push(...(data as ExerciseSessionLog[]));
        if (data.length < SESSION_PAGE) break;
      }
      return rows;
    },
    enabled: !!patientId,
  });
}
