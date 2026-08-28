import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ExerciseProgramme = Tables<"exercise_programmes">;
export type ExerciseReadinessScreen = Tables<"exercise_readiness_screens">;
export type ExerciseEnrollment = Tables<"patient_exercise_enrollments">;

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
