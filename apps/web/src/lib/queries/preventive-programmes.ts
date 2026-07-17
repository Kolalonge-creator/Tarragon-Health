import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PreventiveProgramme = Tables<"preventive_programmes">;
export type PreventiveEnrolment = Tables<"preventive_programme_enrolments">;

const enrolmentsKey = (patientId: string) =>
  ["preventive-enrolments", patientId] as const;

/** Global reference catalogue — same for every patient, active only. */
export function usePreventiveProgrammes() {
  return useQuery({
    queryKey: ["preventive-programmes"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("preventive_programmes")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as PreventiveProgramme[];
    },
  });
}

/** The patient's active (enrolled) preventive-programme enrolments. */
export function usePreventiveEnrolments(patientId: string) {
  return useQuery({
    queryKey: enrolmentsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("preventive_programme_enrolments")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "enrolled");
      if (error) throw error;
      return data as PreventiveEnrolment[];
    },
    enabled: !!patientId,
  });
}

/**
 * Self-enrol the patient in a preventive programme (the pathway's "programme
 * selection" step). Written through the patient's own RLS-scoped session —
 * enrolment is the patient's own explicit choice, not a value the app computes
 * on their behalf, so RLS keeps doing its job. `recommended` only tags whether
 * the risk engine had suggested it, for source attribution.
 */
export function useEnrolPreventiveProgramme(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      programmeId,
      recommended,
    }: {
      programmeId: string;
      recommended: boolean;
    }) => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }
      const { error } = await supabase.from("preventive_programme_enrolments").insert({
        patient_id: patientId,
        organisation_id: profile.organisation_id,
        programme_id: programmeId,
        source: recommended ? "recommended" : "self",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrolmentsKey(patientId) });
      // Enrolling schedules a periodic review server-side — refresh the
      // "next review due" surface too (separate query key).
      queryClient.invalidateQueries({ queryKey: ["preventive-reviews"] });
    },
  });
}

/** Withdraw from a programme — marks the enrolment withdrawn (append-only
 * status change; the periodic-review scheduler only rolls while enrolled). */
export function useWithdrawPreventiveProgramme(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ enrolmentId }: { enrolmentId: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("preventive_programme_enrolments")
        .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
        .eq("id", enrolmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: enrolmentsKey(patientId) });
      queryClient.invalidateQueries({ queryKey: ["preventive-reviews"] });
    },
  });
}
