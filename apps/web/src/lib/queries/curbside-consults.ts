import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums } from "@tarragon/shared";

/**
 * Doctor-to-doctor "curbside consult" — an informal, in-app question between
 * two colleagues (Master Operating Plan §4/§8's Senior Medical Officer tier
 * gap). Deliberately hand-typed rather than `Tables<"curbside_consult_threads">`:
 * `packages/shared/src/database.types.ts` is regenerated from LIVE production,
 * which is every in-flight branch at once (CLAUDE.md's own regeneration
 * warning) — declaring the shape here avoids importing ~128 branches' worth
 * of unrelated schema drift for one new table.
 */
export type DoctorTier = Enums<"doctor_tier">;

export interface CurbsideConsultColleague {
  id: string;
  full_name: string;
  doctor_tier: DoctorTier | null;
}

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
  initiator: CurbsideConsultColleague | null;
  recipient: CurbsideConsultColleague | null;
  patient: { full_name: string | null; patient_number: string | null } | null;
}

export interface CurbsideConsultMessage {
  id: string;
  thread_id: string;
  sender_clinical_staff_id: string | null;
  body: string;
  created_at: string;
  sender: CurbsideConsultColleague | null;
}

const THREAD_SELECT =
  "id, initiator_clinical_staff_id, recipient_clinical_staff_id, subject, status, patient_id, " +
  "last_message_at, last_message_sender_id, closed_at, closed_by, created_at, " +
  "initiator:clinical_staff!curbside_consult_threads_initiator_clinical_staff_id_fkey(id, full_name, doctor_tier), " +
  "recipient:clinical_staff!curbside_consult_threads_recipient_clinical_staff_id_fkey(id, full_name, doctor_tier), " +
  "patient:profiles!curbside_consult_threads_patient_id_fkey(full_name, patient_number)";

const MESSAGE_SELECT =
  "id, thread_id, sender_clinical_staff_id, body, created_at, " +
  "sender:clinical_staff!curbside_consult_messages_sender_clinical_staff_id_fkey(id, full_name, doctor_tier)";

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

/** Doctor-tier colleagues in the caller's own org who could receive a
 * curbside consult — same shape as useAssignableDoctors
 * (lib/queries/clinical-staff.ts), but that one is scoped to the Chief
 * Medical Officer's case-reassignment control; this is open to any clinician
 * picking a peer to ask. Care Coordinators are excluded server-side too
 * (private.enforce_curbside_consult_thread), this is just the friendly UI
 * filter so one never shows up in the picker to begin with. */
export function useCurbsideConsultColleagues() {
  return useQuery({
    queryKey: ["curbside-consult-colleagues"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("id, full_name, doctor_tier")
        .neq("doctor_tier", "care_coordinator")
        .eq("active", true)
        .not("profile_id", "is", null)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return data as CurbsideConsultColleague[];
    },
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
