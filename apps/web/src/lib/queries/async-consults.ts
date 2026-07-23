import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AsyncConsult = Tables<"async_consults">;

export type AsyncConsultWithAnswerer = AsyncConsult & {
  answerer: {
    full_name: string;
    credential_type: string | null;
    credential_number: string | null;
  } | null;
};

export type AsyncConsultWithPatient = AsyncConsult & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

export const asyncConsultKeys = {
  mine: (patientId: string) => ["async-consults", "mine", patientId] as const,
  org: ["async-consults", "org"] as const,
};

/** The patient's own consult history, newest first — RLS returns only theirs. */
export function useMyAsyncConsults(patientId: string) {
  return useQuery({
    queryKey: asyncConsultKeys.mine(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("async_consults")
        .select(
          "*, answerer:clinical_staff!async_consults_answered_by_fkey(full_name, credential_type, credential_number)"
        )
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as AsyncConsultWithAnswerer[];
    },
  });
}

/** Patient submits a new question. organisation_id is pinned by RLS to their own org. */
export function useSubmitAsyncConsult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      category,
      question,
      durationNote,
    }: {
      patientId: string;
      organisationId: string;
      category: string;
      question: string;
      durationNote?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("async_consults").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        category,
        question,
        duration_note: durationNote || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: asyncConsultKeys.mine(variables.patientId) });
    },
  });
}

/** Doctor-side worklist: everything awaiting an answer, soonest SLA first. */
export function useOrgAsyncConsults() {
  return useQuery({
    queryKey: asyncConsultKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("async_consults")
        .select(
          "*, patient:profiles!async_consults_patient_id_fkey(full_name, patient_number)"
        )
        .in("status", ["submitted", "in_review"])
        .order("sla_due_at", { ascending: true });
      if (error) throw error;
      return data as AsyncConsultWithPatient[];
    },
  });
}

/** Claim a consult for review (visible state change so two doctors don't double-answer). */
export function useMarkConsultInReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (consultId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("async_consults")
        .update({ status: "in_review" })
        .eq("id", consultId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: asyncConsultKeys.org });
    },
  });
}
