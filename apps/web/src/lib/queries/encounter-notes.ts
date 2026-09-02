import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ClinicalEncounterNote = Tables<"clinical_encounter_notes">;

const notesQueryKey = (patientId: string) => ["clinical-encounter-notes", patientId];

/** All encounter notes for one patient, newest encounter first. */
export function usePatientEncounterNotes(patientId: string) {
  return useQuery({
    queryKey: notesQueryKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_encounter_notes")
        .select("*")
        .eq("patient_id", patientId)
        .order("encounter_date", { ascending: false });
      if (error) throw error;
      return data as ClinicalEncounterNote[];
    },
  });
}

/**
 * Starts a new draft encounter note. authored_by_staff/authored_by_profile
 * and status are all server-derived by private.enforce_clinical_encounter_note_attribution
 * (the DB trigger, not this call) — the RLS policy + trigger together reject
 * the insert outright if the caller isn't an active clinical-tier member of
 * the patient's org, so no client-side gating is load-bearing here.
 */
export function useCreateEncounterNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      patientId: string;
      encounterType: ClinicalEncounterNote["encounter_type"];
      reasonForEncounter: string;
      history?: string;
      examinationFindings?: string;
      assessment?: string;
      diagnosis?: string;
      plan?: string;
      followUpInstructions?: string;
      videoConsultationId?: string;
      escalationId?: string;
      asyncConsultId?: string;
      callStartedAt?: string;
      callEndedAt?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_encounter_notes")
        .insert({
          organisation_id: input.organisationId,
          patient_id: input.patientId,
          encounter_type: input.encounterType,
          reason_for_encounter: input.reasonForEncounter,
          history: input.history || null,
          examination_findings: input.examinationFindings || null,
          assessment: input.assessment || null,
          diagnosis: input.diagnosis || null,
          plan: input.plan || null,
          follow_up_instructions: input.followUpInstructions || null,
          video_consultation_id: input.videoConsultationId || null,
          escalation_id: input.escalationId || null,
          async_consult_id: input.asyncConsultId || null,
          call_started_at: input.callStartedAt || null,
          call_ended_at: input.callEndedAt || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey(variables.patientId) });
    },
  });
}

/** Edits a note that is still a draft — the DB rejects any edit once status is 'finalized'. */
export function useUpdateEncounterNoteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      noteId,
      fields,
    }: {
      noteId: string;
      patientId: string;
      fields: Partial<
        Pick<
          ClinicalEncounterNote,
          | "reason_for_encounter"
          | "history"
          | "examination_findings"
          | "assessment"
          | "diagnosis"
          | "plan"
          | "follow_up_instructions"
        >
      >;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_encounter_notes")
        .update(fields)
        .eq("id", noteId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey(variables.patientId) });
    },
  });
}

/**
 * Signs and locks a draft note. private.enforce_clinical_encounter_note_attribution
 * stamps finalized_by_staff/finalized_at server-side and blocks any further
 * edit — this is a one-way transition, mirrored by the DB's own CHECK
 * constraints (clinical_encounter_notes_finalized_requires_signoff /
 * clinical_encounter_notes_finalized_requires_outcome — every finalized note
 * must record a Consultation System §9.15 outcome, so `outcome` is required
 * here, not optional).
 */
export function useFinalizeEncounterNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      noteId,
      outcome,
      identityConfirmed,
    }: {
      noteId: string;
      patientId: string;
      outcome: NonNullable<ClinicalEncounterNote["outcome"]>;
      /** Wrong-patient prevention (§89.4) — the DB rejects finalizing without
       * this; private.enforce_clinical_encounter_note_attribution() derives
       * identity_confirmed_by/at server-side, this flag is the only thing
       * the client actually controls. */
      identityConfirmed: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_encounter_notes")
        .update({ status: "finalized", outcome, identity_confirmed: identityConfirmed })
        .eq("id", noteId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey(variables.patientId) });
    },
  });
}
