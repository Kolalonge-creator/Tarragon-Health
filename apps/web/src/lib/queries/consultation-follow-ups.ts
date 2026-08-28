import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ConsultationFollowUp = Tables<"consultation_follow_ups">;

const followUpsQueryKey = (noteId: string) => ["consultation-follow-ups", noteId];

/** All follow-ups recorded against one encounter note. */
export function useEncounterFollowUps(noteId: string) {
  return useQuery({
    queryKey: followUpsQueryKey(noteId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("consultation_follow_ups")
        .select("*")
        .eq("encounter_note_id", noteId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ConsultationFollowUp[];
    },
    enabled: Boolean(noteId),
  });
}

/**
 * Records a follow-up instruction from a consultation's plan. organisation_id/
 * patient_id/created_by_staff/status are all server-derived by
 * private.enforce_consultation_follow_up_write (the DB trigger) from
 * encounter_note_id and the caller's own clinical_staff row — never trusted
 * from the client. Consultation System §9.16.
 */
export function useCreateFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      encounterNoteId: string;
      organisationId: string;
      patientId: string;
      actionType: ConsultationFollowUp["action_type"];
      description: string;
      dueAt?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("consultation_follow_ups").insert({
        encounter_note_id: input.encounterNoteId,
        organisation_id: input.organisationId,
        patient_id: input.patientId,
        action_type: input.actionType,
        description: input.description,
        due_at: input.dueAt || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: followUpsQueryKey(variables.encounterNoteId) });
    },
  });
}

/**
 * Turns a pending follow-up into the real downstream record it describes —
 * a monitoring cadence, a specialist referral, or a Care Coordinator
 * outreach task, per action_type. See action_consultation_follow_up.
 */
export function useActionFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      followUpId: string;
      encounterNoteId: string;
      monitoringFrequencyDays?: number;
      referralSpecialistType?: string;
      referralReason?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("action_consultation_follow_up", {
        p_followup_id: input.followUpId,
        p_monitoring_frequency_days: input.monitoringFrequencyDays ?? null,
        p_referral_specialist_type: input.referralSpecialistType ?? null,
        p_referral_reason: input.referralReason ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: followUpsQueryKey(variables.encounterNoteId) });
    },
  });
}

export function useMarkFollowUpNotNeeded() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { followUpId: string; encounterNoteId: string; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("mark_consultation_follow_up_not_needed", {
        p_followup_id: input.followUpId,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: followUpsQueryKey(variables.encounterNoteId) });
    },
  });
}
