import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type VideoConsultation = Tables<"video_consultations">;
export type ConsultationPatientSummary = Tables<"consultation_patient_summaries">;

/** Shape of consultation_prep_bundle()'s jsonb result — a deterministic read
 * model (68.4/68.9), not a new source of truth; every field here already
 * lives on its own table (patient_conditions, patient_allergies,
 * vitals_readings, medications, screening_results, patient_care_gaps,
 * care_plans, clinical_encounter_notes). */
export interface ConsultationPrepBundle {
  reason: { patient_prep_notes: string | null; request_note: string | null };
  active_conditions: {
    condition_name: string;
    status: string;
    severity: string | null;
    date_identified: string | null;
  }[];
  allergies: { allergen: string; reaction: string | null; severity: string | null }[];
  recent_vitals: Record<string, unknown>[];
  active_medications: { drug_name: string; dose: string | null; frequency: string | null; refill_date: string | null }[];
  recent_results: { result_status: string; result_summary: string | null; abnormal_flags: string[] | null; created_at: string }[];
  care_gaps: { gap_type: string; condition_or_type: string | null; opened_at: string }[];
  active_care_plans: { condition: string; status: string; created_at: string }[];
  previous_consultations: {
    encounter_type: string;
    encounter_date: string;
    diagnosis: string | null;
    outcome: string | null;
  }[];
}

const consultationVideoKeys = {
  prepBundle: (id: string) => ["consultation-prep-bundle", id] as const,
  detail: (id: string) => ["video-consultations", "detail", id] as const,
  appointmentFor: (id: string) => ["appointments", "for-video-consultation", id] as const,
  summary: (id: string) => ["consultation-patient-summaries", id] as const,
};

/** 68.9 clinical consultation screen — everything a clinician needs about
 * this patient in one read, without navigating multiple disconnected
 * screens. Staff-only (enforced server-side by the RPC). */
export function useConsultationPrepBundle(consultationId: string) {
  return useQuery({
    queryKey: consultationVideoKeys.prepBundle(consultationId),
    enabled: Boolean(consultationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("consultation_prep_bundle", {
        p_consultation_id: consultationId,
      });
      if (error) throw error;
      return data as unknown as ConsultationPrepBundle;
    },
  });
}

/** The full video_consultations row for the clinician consultation screen,
 * with host_start_url filled from video_consultation_host_links. The host
 * link never lives on video_consultations itself (a trigger moves it, and the
 * column is always NULL) because that table is readable by the patient; the
 * side table is readable by org staff only (migration
 * 20261105102455_video_consultation_host_link_staff_only). */
export function useVideoConsultationDetail(consultationId: string) {
  return useQuery({
    queryKey: consultationVideoKeys.detail(consultationId),
    enabled: Boolean(consultationId),
    queryFn: () => fetchVideoConsultationDetail(createClient(), consultationId),
  });
}

export async function fetchVideoConsultationDetail(
  supabase: ReturnType<typeof createClient>,
  consultationId: string,
): Promise<VideoConsultation | null> {
  const [consultation, hostLink] = await Promise.all([
    supabase.from("video_consultations").select("*").eq("id", consultationId).maybeSingle(),
    supabase
      .from("video_consultation_host_links")
      .select("host_start_url")
      .eq("video_consultation_id", consultationId)
      .maybeSingle(),
  ]);
  if (consultation.error) throw consultation.error;
  if (hostLink.error) throw hostLink.error;
  if (!consultation.data) return null;
  return { ...consultation.data, host_start_url: hostLink.data?.host_start_url ?? null };
}

/** The Appointment Engine row this consultation was booked through, if any
 * — a video_consultations row created directly (pre_referral_triage /
 * specialist_consult / a paid video_visit_request) has none. */
export function useAppointmentForVideoConsultation(consultationId: string) {
  return useQuery({
    queryKey: consultationVideoKeys.appointmentFor(consultationId),
    enabled: Boolean(consultationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("appointments")
        .select("id, status, patient_id, clinician_id, no_show_reason")
        .eq("video_consultation_id", consultationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function invalidateConsultation(queryClient: ReturnType<typeof useQueryClient>, consultationId: string) {
  queryClient.invalidateQueries({ queryKey: consultationVideoKeys.detail(consultationId) });
  queryClient.invalidateQueries({ queryKey: consultationVideoKeys.appointmentFor(consultationId) });
  queryClient.invalidateQueries({ queryKey: ["appointments"] });
}

/** 68.5/68.16 — start/end the call, keeping the linked appointment's status
 * moving with it (handled server-side in the one RPC call). */
export function useSetVideoConsultationCallState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { consultationId: string; status: "started" | "completed" | "cancelled" }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("set_video_consultation_call_state", {
        p_video_consultation_id: input.consultationId,
        p_status: input.status,
      });
      if (error) throw error;
      return data as VideoConsultation;
    },
    onSuccess: (_data, variables) => invalidateConsultation(queryClient, variables.consultationId),
  });
}

/** 68.8 — confirms the right patient/clinician are on this call. */
export function useConfirmConsultationIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (consultationId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("confirm_consultation_identity", {
        p_video_consultation_id: consultationId,
      });
      if (error) throw error;
      return data as VideoConsultation;
    },
    onSuccess: (_data, consultationId) => invalidateConsultation(queryClient, consultationId),
  });
}

/** 68.17 — the patient-facing recap for a completed, signed consultation. */
export function useConsultationSummary(consultationId: string) {
  return useQuery({
    queryKey: consultationVideoKeys.summary(consultationId),
    enabled: Boolean(consultationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("consultation_patient_summaries")
        .select("*")
        .eq("video_consultation_id", consultationId)
        .maybeSingle();
      if (error) throw error;
      return data as ConsultationPatientSummary | null;
    },
  });
}

/** Publishes the curated post-visit summary from a finalised encounter note
 * — clinical-tier gated server-side, one per note (publish-once). */
export function usePublishConsultationSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      clinicalEncounterNoteId: string;
      videoConsultationId: string;
      whatWeDiscussed: string;
      whatYouNeedToDo?: string;
      medicinesNote?: string;
      testsNote?: string;
      nextAppointmentNote?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("publish_consultation_summary", {
        p_clinical_encounter_note_id: input.clinicalEncounterNoteId,
        p_what_we_discussed: input.whatWeDiscussed,
        p_what_you_need_to_do: input.whatYouNeedToDo || undefined,
        p_medicines_note: input.medicinesNote || undefined,
        p_tests_note: input.testsNote || undefined,
        p_next_appointment_note: input.nextAppointmentNote || undefined,
      });
      if (error) throw error;
      return data as ConsultationPatientSummary;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: consultationVideoKeys.summary(variables.videoConsultationId) });
    },
  });
}
