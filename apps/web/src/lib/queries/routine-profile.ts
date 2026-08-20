import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type RoutinePreference = "morning" | "evening" | "varies";

type PatientProfile = { routine?: RoutinePreference } | null;

/**
 * The patient's own active `lpe_enrollments` row and whatever routine
 * preference (if any) is already stored on it — one enrolment is enough to
 * know whether to show the one-time prompt; a patient with more than one
 * active enrolment shares a single preference across all of them (there's
 * only one patient routine, not one per condition).
 */
export function useRoutineProfile(patientId: string) {
  return useQuery({
    queryKey: ["routine-profile", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lpe_enrollments")
        .select("id, patient_profile")
        .eq("patient_id", patientId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const profile = data.patient_profile as PatientProfile;
      return { enrollmentId: data.id, routine: profile?.routine ?? null };
    },
    enabled: !!patientId,
  });
}

export function useSetRoutinePreference(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      enrollmentId,
      routine,
    }: {
      enrollmentId: string;
      routine: RoutinePreference;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lpe_enrollments")
        .update({ patient_profile: { routine } })
        .eq("id", enrollmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routine-profile", patientId] });
    },
  });
}
