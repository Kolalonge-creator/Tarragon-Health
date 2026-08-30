import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type CareThread = Tables<"care_message_threads">;

/** A thread plus the (null-gated) patient identity — used by the staff worklist. */
export type CareThreadWithPatient = CareThread & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

/**
 * A message plus the (null-gated) acting staff member. `actor` is only ever a
 * real clinical_staff row (FK-guaranteed) — but a real row is not the same as
 * a real doctor: a Care Coordinator carries an active clinical_staff row too
 * (doctor_tier = 'care_coordinator'), so a "Dr X" line must not be rendered
 * from a non-null actor alone. doctor_tier lets the UI run isClinicalTier
 * (lib/clinical/doctor-tier.ts) first — see authorLabel in
 * components/care-message-thread.tsx. A patient/sponsor author has no actor.
 */
export type CareMessage = Tables<"care_messages"> & {
  actor: {
    full_name: string | null;
    credential_type: string | null;
    credential_number: string | null;
    doctor_tier: Enums<"doctor_tier"> | null;
  } | null;
};

const MESSAGE_SELECT =
  "*, actor:clinical_staff!care_messages_actor_clinical_staff_id_fkey(full_name, credential_type, credential_number, doctor_tier)";
const THREAD_PATIENT_SELECT =
  "*, patient:profiles!care_message_threads_patient_id_fkey(full_name, patient_number)";

/** A single patient's message threads, newest activity first. */
export function useCareThreads(patientId: string) {
  return useQuery({
    queryKey: ["care-threads", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_message_threads")
        .select("*")
        .eq("patient_id", patientId)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return data as CareThread[];
    },
    enabled: !!patientId,
  });
}

/** All threads visible to the caller's org (staff worklist), newest activity first. */
export function useOrgCareThreads() {
  return useQuery({
    queryKey: ["org-care-threads"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_message_threads")
        .select(THREAD_PATIENT_SELECT)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return data as unknown as CareThreadWithPatient[];
    },
  });
}

/** Messages in a thread, oldest first (reading order). */
export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: ["care-messages", threadId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_messages")
        .select(MESSAGE_SELECT)
        .eq("thread_id", threadId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as CareMessage[];
    },
    enabled: !!threadId,
  });
}

export function useStartThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      subject: string;
      body: string;
      patientId?: string;
      escalationId?: string;
      carePlanId?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("start_care_thread", {
        p_subject: input.subject,
        p_body: input.body,
        p_patient_id: input.patientId,
        p_escalation_id: input.escalationId,
        p_care_plan_id: input.carePlanId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care-threads"] });
      queryClient.invalidateQueries({ queryKey: ["org-care-threads"] });
    },
  });
}

export function usePostMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { threadId: string; body: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("post_care_message", {
        p_thread_id: input.threadId,
        p_body: input.body,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["care-messages", input.threadId] });
      queryClient.invalidateQueries({ queryKey: ["care-threads"] });
      queryClient.invalidateQueries({ queryKey: ["org-care-threads"] });
    },
  });
}

export function useCloseThread() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_message_threads")
        .update({ status: "closed" })
        .eq("id", threadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care-threads"] });
      queryClient.invalidateQueries({ queryKey: ["org-care-threads"] });
    },
  });
}
