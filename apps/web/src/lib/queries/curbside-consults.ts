import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { DOCTOR_ATTRIBUTION_FIELDS_WITH_TIER, type DoctorAttributionWithTier } from "@/lib/queries/clinical-staff";

/**
 * Doctor-to-doctor "curbside consult" — an informal, in-app question between
 * two colleagues (Master Operating Plan §4/§8's Senior Medical Officer tier
 * gap). Deliberately hand-typed rather than `Tables<"curbside_consult_threads">`:
 * `packages/shared/src/database.types.ts` is regenerated from LIVE production,
 * which is every in-flight branch at once (CLAUDE.md's own regeneration
 * warning) — declaring the shape here avoids importing ~128 branches' worth
 * of unrelated schema drift for one new table.
 */

/** Re-export so callers only need to import from this module — the
 * underlying query is @/lib/queries/clinical-staff's useAssignableDoctors,
 * which already selects every active, non-Care-Coordinator doctor in the
 * caller's org (id, profile_id, full_name, doctor_tier). Reusing it here
 * rather than a second hand-rolled query keeps the eligibility rule (who
 * counts as "assignable"/"askable") in exactly one place. */
export { useAssignableDoctors as useCurbsideConsultColleagues } from "@/lib/queries/clinical-staff";

export interface CurbsideConsultThread {
  id: string;
  initiator_clinical_staff_id: string;
  recipient_clinical_staff_id: string;
  subject: string;
  status: "open" | "closed";
  patient_id: string | null;
  last_message_at: string;
  last_message_sender_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  initiator: DoctorAttributionWithTier | null;
  recipient: DoctorAttributionWithTier | null;
  // Schema/RPC-ready (migration header: "regarding this patient" context
  // only, no new PHI-access grant) but deliberately not surfaced in the v1
  // UI — no compose-form field sets patientId and no view renders it yet.
  // Fetched here so a future UI pass has it without another query change.
  patient: { full_name: string | null; patient_number: string | null } | null;
}

export interface CurbsideConsultMessage {
  id: string;
  thread_id: string;
  sender_clinical_staff_id: string | null;
  body: string;
  created_at: string;
  sender: DoctorAttributionWithTier | null;
}

const THREAD_SELECT =
  "id, initiator_clinical_staff_id, recipient_clinical_staff_id, subject, status, patient_id, " +
  "last_message_at, last_message_sender_id, closed_at, closed_by, created_at, " +
  `initiator:clinical_staff!curbside_consult_threads_initiator_clinical_staff_id_fkey(${DOCTOR_ATTRIBUTION_FIELDS_WITH_TIER}), ` +
  `recipient:clinical_staff!curbside_consult_threads_recipient_clinical_staff_id_fkey(${DOCTOR_ATTRIBUTION_FIELDS_WITH_TIER}), ` +
  "patient:profiles!curbside_consult_threads_patient_id_fkey(full_name, patient_number)";

const MESSAGE_SELECT =
  "id, thread_id, sender_clinical_staff_id, body, created_at, " +
  `sender:clinical_staff!curbside_consult_messages_sender_clinical_staff_id_fkey(${DOCTOR_ATTRIBUTION_FIELDS_WITH_TIER})`;

/** Every curbside consult the signed-in clinician is a party to — RLS already
 * scopes this to threads where they're the initiator or the recipient, so no
 * extra filter is needed here. Newest activity first. */
export function useCurbsideConsultThreads() {
  return useQuery({
    queryKey: ["curbside-consult-threads"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("curbside_consult_threads")
        .select(THREAD_SELECT)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return data as unknown as CurbsideConsultThread[];
    },
  });
}

export function useCurbsideConsultMessages(threadId: string) {
  return useQuery({
    queryKey: ["curbside-consult-messages", threadId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("curbside_consult_messages")
        .select(MESSAGE_SELECT)
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as CurbsideConsultMessage[];
    },
    enabled: !!threadId,
  });
}

export function useStartCurbsideConsult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      recipientClinicalStaffId: string;
      subject: string;
      body: string;
      patientId?: string | null;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("start_curbside_consult", {
        p_recipient_clinical_staff_id: input.recipientClinicalStaffId,
        p_subject: input.subject,
        p_body: input.body,
        // p_patient_id has a SQL DEFAULT null, so omitting the key (via
        // undefined, which PostgREST drops) is genuinely equivalent to
        // passing null explicitly — see the RPC-args-null-typegen memory.
        p_patient_id: input.patientId ?? undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curbside-consult-threads"] });
      queryClient.invalidateQueries({ queryKey: ["worklist-counts"] });
    },
  });
}

export function usePostCurbsideConsultMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ threadId, body }: { threadId: string; body: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("post_curbside_consult_message", {
        p_thread_id: threadId,
        p_body: body,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["curbside-consult-messages", variables.threadId] });
      queryClient.invalidateQueries({ queryKey: ["curbside-consult-threads"] });
      queryClient.invalidateQueries({ queryKey: ["worklist-counts"] });
    },
  });
}

export function useCloseCurbsideConsult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("close_curbside_consult", { p_thread_id: threadId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["curbside-consult-threads"] });
      queryClient.invalidateQueries({ queryKey: ["worklist-counts"] });
    },
  });
}
