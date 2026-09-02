import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { generateDraftReplyAction } from "@/lib/care-messages/actions";
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
 * from a non-null actor alone. doctor_tier + is_clinical_director let the UI
 * run isClinicalTier (lib/clinical/doctor-tier.ts) first — see authorLabel in
 * components/care-message-thread.tsx. A patient/sponsor author has no actor.
 */
export type CareMessageAttachment = Tables<"care_message_attachments">;

export type CareMessage = Tables<"care_messages"> & {
  actor: {
    full_name: string | null;
    credential_type: string | null;
    credential_number: string | null;
    doctor_tier: Enums<"doctor_tier"> | null;
    is_clinical_director: boolean;
  } | null;
  attachments: CareMessageAttachment[];
};

export type CareMessageTemplate = Tables<"care_message_templates">;

const MESSAGE_SELECT =
  "*, actor:clinical_staff!care_messages_actor_clinical_staff_id_fkey(full_name, credential_type, credential_number, doctor_tier, is_clinical_director), attachments:care_message_attachments(*)";
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
      category?: Enums<"care_message_category">;
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
        p_category: input.category ?? "general",
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

export type CareMessageDraftReply = Tables<"care_message_draft_replies">;

/** The current AI-drafted reply suggestion for a thread, staff-only (RLS).
 * Null when none has been generated yet. */
export function useDraftReply(threadId: string | null) {
  return useQuery({
    queryKey: ["care-message-draft-reply", threadId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_message_draft_replies")
        .select("*")
        .eq("thread_id", threadId as string)
        .maybeSingle();
      if (error) throw error;
      return data as CareMessageDraftReply | null;
    },
    enabled: !!threadId,
  });
}

/** Manual only -- see generateDraftReplyAction's docstring for why this is
 * never triggered automatically on an inbound message. */
export function useGenerateDraftReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const result = await generateDraftReplyAction(threadId);
      if (!result.success) throw new Error("Could not generate a draft reply");
      return result;
    },
    onSuccess: (_data, threadId) => {
      queryClient.invalidateQueries({ queryKey: ["care-message-draft-reply", threadId] });
    },
  });
}

/** 77.13 — stamp the caller's read clock on a thread. Fire-and-forget: call
 * on mount / whenever the open thread's id changes, no loading UI needed. */
export function useMarkThreadRead() {
  return useMutation({
    mutationFn: async (threadId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("mark_care_message_thread_read", {
        p_thread_id: threadId,
      });
      if (error) throw error;
    },
  });
}

/** 77.7 — the org's active reply templates, optionally filtered by category. */
export function useCareMessageTemplates(category?: Enums<"care_message_template_category">) {
  return useQuery({
    queryKey: ["care-message-templates", category ?? "all"],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("care_message_templates")
        .select("*")
        .eq("is_active", true)
        .order("title", { ascending: true });
      if (category) query = query.eq("category", category);
      const { data, error } = await query;
      if (error) throw error;
      return data as CareMessageTemplate[];
    },
  });
}

export function useCreateCareMessageTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      body: string;
      category: Enums<"care_message_template_category">;
    }) => {
      const supabase = createClient();
      const { data: org } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
        .single();
      if (!org?.organisation_id) throw new Error("No organisation on this account");
      const { error } = await supabase.from("care_message_templates").insert({
        organisation_id: org.organisation_id,
        title: input.title,
        body: input.body,
        category: input.category,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care-message-templates"] });
    },
  });
}

export function useSetCareMessageTemplateActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_message_templates")
        .update({ is_active: input.isActive })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["care-message-templates"] });
    },
  });
}

/** 77.10 — upload a file into the patient's own attachment folder, then link
 * it to an existing message. The message must already exist (post the reply
 * first via usePostMessage/useStartThread, then attach) — see
 * care-message-thread.tsx for the two-step flow. */
export function useUploadCareMessageAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { messageId: string; threadId: string; patientId: string; file: File }) => {
      const supabase = createClient();

      // The BEFORE INSERT trigger (private.enforce_care_message_attachment_
      // scope) overwrites organisation_id/patient_id/thread_id from the
      // message row regardless of what's sent — reading them here first is
      // just to satisfy the Insert type's NOT NULL columns with the same
      // real values the trigger would derive anyway.
      const { data: message, error: messageError } = await supabase
        .from("care_messages")
        .select("organisation_id, patient_id, thread_id")
        .eq("id", input.messageId)
        .single();
      if (messageError) throw messageError;

      const ext = input.file.name.includes(".") ? input.file.name.split(".").pop() : "bin";
      const path = `${input.patientId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("care-message-attachments")
        .upload(path, input.file, { contentType: input.file.type });
      if (uploadError) throw uploadError;

      const { error } = await supabase.from("care_message_attachments").insert({
        organisation_id: message.organisation_id,
        patient_id: message.patient_id,
        thread_id: message.thread_id,
        message_id: input.messageId,
        file_path: path,
        original_filename: input.file.name,
        mime_type: input.file.type,
        file_size_bytes: input.file.size,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["care-messages", input.threadId] });
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
