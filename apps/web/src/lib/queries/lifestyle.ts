import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type LifestyleAssessment = Tables<"lifestyle_assessments">;
export type LifestyleGoal = Tables<"lifestyle_goals">;
export type LifestyleProgramme = Tables<"lifestyle_programmes">;
export type LifestyleEnrolment = Tables<"lifestyle_programme_enrolments">;
export type LifestyleCheckin = Tables<"lifestyle_checkins">;
export type LifestyleReview = Tables<"lifestyle_reviews">;

export type LifestyleEnrolmentWithProgramme = LifestyleEnrolment & {
  programme: Pick<LifestyleProgramme, "name" | "domain" | "duration_weeks"> | null;
};

export type LifestyleReviewWithPatient = LifestyleReview & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

// --- assessments -----------------------------------------------------------
/** The patient's most recent baseline assessment (null when none taken). */
export function useLatestLifestyleAssessment(patientId: string) {
  return useQuery({
    queryKey: ["lifestyle-assessment", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lifestyle_assessments")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as LifestyleAssessment | null;
    },
    enabled: !!patientId,
  });
}

// --- goals -----------------------------------------------------------------
export function useLifestyleGoals(patientId: string) {
  return useQuery({
    queryKey: ["lifestyle-goals", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lifestyle_goals")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LifestyleGoal[];
    },
    enabled: !!patientId,
  });
}

/** Mark a goal achieved/abandoned/active (patient-owned, no org needed). */
export function useUpdateGoalStatus(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      goalId,
      status,
    }: {
      goalId: string;
      status: LifestyleGoal["status"];
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lifestyle_goals")
        .update({
          status,
          achieved_at: status === "achieved" ? new Date().toISOString() : null,
        })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lifestyle-goals", patientId] });
    },
  });
}

// --- programmes + enrolments ----------------------------------------------
/** Active diet/exercise programme templates the patient can enrol in. */
export function useActiveLifestyleProgrammes() {
  return useQuery({
    queryKey: ["lifestyle-programmes", "active"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lifestyle_programmes")
        .select("*")
        .eq("is_active", true)
        .order("domain", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as LifestyleProgramme[];
    },
  });
}

export function useMyLifestyleEnrolments(patientId: string) {
  return useQuery({
    queryKey: ["lifestyle-enrolments", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lifestyle_programme_enrolments")
        .select(
          "*, programme:lifestyle_programmes!lifestyle_programme_enrolments_programme_id_fkey(name, domain, duration_weeks)",
        )
        .eq("patient_id", patientId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data as LifestyleEnrolmentWithProgramme[];
    },
    enabled: !!patientId,
  });
}

// --- check-ins -------------------------------------------------------------
/** Pending, due (on/before today) check-ins, soonest first. */
export function usePatientDueLifestyleCheckins(patientId: string) {
  return useQuery({
    queryKey: ["lifestyle-checkins", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lifestyle_checkins")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .lte("due_date", todayIso())
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as LifestyleCheckin[];
    },
    enabled: !!patientId,
  });
}

/** Patient answers a check-in in the app (WhatsApp/SMS only reminds). */
export function useRespondToLifestyleCheckin(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ checkinId, response }: { checkinId: string; response: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lifestyle_checkins")
        .update({ status: "responded", response, responded_at: new Date().toISOString() })
        .eq("id", checkinId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lifestyle-checkins", patientId] });
    },
  });
}

// --- reviews ---------------------------------------------------------------
/** The patient's next upcoming progress review (earliest pending). */
export function usePatientNextLifestyleReview(patientId: string) {
  return useQuery({
    queryKey: ["lifestyle-reviews", "next", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lifestyle_reviews")
        .select("*")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .order("due_date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as LifestyleReview | null;
    },
    enabled: !!patientId,
  });
}

/** Org staff worklist — pending progress reviews, soonest-due first. */
export function useOrgLifestyleReviews() {
  return useQuery({
    queryKey: ["lifestyle-reviews", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lifestyle_reviews")
        .select(
          "*, patient:profiles!lifestyle_reviews_patient_id_fkey(full_name, patient_number)",
        )
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as LifestyleReviewWithPatient[];
    },
  });
}

/**
 * Complete a review. reviewed_by/completed_at are stamped server-side by
 * private.stamp_lifestyle_review_completion from the caller's clinical_staff
 * row — never sent from here — and completing rolls the next review.
 */
export function useCompleteLifestyleReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reviewId, notes }: { reviewId: string; notes: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lifestyle_reviews")
        .update({ status: "completed", notes })
        .eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lifestyle-reviews"] });
    },
  });
}
