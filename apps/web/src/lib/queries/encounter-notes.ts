import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import { ROUTINE_CHART_READ_REASON } from "@/lib/clinical/audited-chart";

export type ClinicalEncounterNote = Tables<"clinical_encounter_notes">;

const notesQueryKey = (patientId: string) => ["clinical-encounter-notes", patientId];

/**
 * A clinician's own auto-drafted notes still waiting for them to review and
 * sign — the "continuous note" worklist: every escalation resolved, async
 * consult answered, or video consultation completed under this clinician's
 * name guarantees a draft here (see private.auto_draft_note_from_* /
 * 20260917031004_auto_generated_continuous_clinical_note.sql), so this is
 * the one place a nothing-was-documented gap would surface.
 */
export function useMyPendingAutoDraftedNotes(staffId: string | undefined) {
  return useQuery({
    queryKey: ["my-pending-auto-drafted-notes", staffId],
    enabled: Boolean(staffId),
    queryFn: async () => {
      const supabase = createClient();
      // INV-10: the table is closed to direct reads; this returns only the caller's own auto-drafted notes.
      const { data, error } = await supabase.rpc("my_pending_auto_drafted_notes");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        patient_id: row.patient_id,
        encounter_type: row.encounter_type,
        encounter_date: row.encounter_date,
        reason_for_encounter: row.reason_for_encounter,
        patient: { full_name: row.patient_name },
      }));
    },
  });
}

/** Turns the audited read's response into notes, throwing for a refusal or a malformed response so neither can read as "no notes". */
export function parseEncounterNotesPayload(data: unknown): PatientEncounterNotes {
  const payload = data as { status?: string; notes?: unknown } | null;
  if (!payload || payload.status === "denied") throw new Error("encounter notes denied");
  if ((payload.status !== "ok" && payload.status !== "own_only") || !Array.isArray(payload.notes)) {
    throw new Error("unexpected encounter notes response");
  }
  return { notes: payload.notes as ClinicalEncounterNote[], scope: payload.status === "ok" ? "all" : "own_only" };
}

export interface PatientEncounterNotes {
  notes: ClinicalEncounterNote[];
  /** `all`: the caller is tied to the patient. `own_only`: not tied, so only the notes she wrote (to finish signing them). */
  scope: "all" | "own_only";
}

/**
 * All encounter notes for one patient, newest encounter first, through the audited read (INV-10). A refusal or error throws, so the
 * screen shows "not available" rather than "No clinical notes yet".
 */
export function usePatientEncounterNotes(patientId: string) {
  return useQuery({
    queryKey: notesQueryKey(patientId),
    // Every read writes an audit row: do not refetch on focus or remount within the visit (mutations invalidate explicitly).
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<PatientEncounterNotes> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("read_patient_encounter_notes_audited", {
        p_patient: patientId,
        p_reason: ROUTINE_CHART_READ_REASON,
      });
      if (error) throw error;
      return parseEncounterNotesPayload(data);
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
      // The organisation is derived from the patient on the server, never taken from the client (input.organisationId is unused).
      const { data, error } = await supabase.rpc("create_encounter_note", {
        p_patient: input.patientId,
        p_encounter_type: input.encounterType,
        p_reason: input.reasonForEncounter,
        p_history: input.history || undefined,
        p_examination: input.examinationFindings || undefined,
        p_assessment: input.assessment || undefined,
        p_diagnosis: input.diagnosis || undefined,
        p_plan: input.plan || undefined,
        p_follow_up: input.followUpInstructions || undefined,
        p_video_consultation_id: input.videoConsultationId || undefined,
        p_escalation_id: input.escalationId || undefined,
        p_async_consult_id: input.asyncConsultId || undefined,
        p_call_started_at: input.callStartedAt || undefined,
        p_call_ended_at: input.callEndedAt || undefined,
      });
      if (error) throw error;
      return { id: data };
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
      const { error } = await supabase.rpc("update_encounter_note_draft", { p_note: noteId, p_fields: fields });
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
      /** Wrong-patient prevention (§89.4) — the DB rejects finalising without
       * this; private.enforce_clinical_encounter_note_attribution() derives
       * identity_confirmed_by/at server-side, this flag is the only thing
       * the client actually controls. */
      identityConfirmed: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("finalize_encounter_note", {
        p_note: noteId,
        p_outcome: outcome,
        p_identity_confirmed: identityConfirmed,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey(variables.patientId) });
    },
  });
}
