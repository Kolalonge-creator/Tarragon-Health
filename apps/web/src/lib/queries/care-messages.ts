import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { generateDraftReplyAction } from "@/lib/care-messages/actions";
import { compareThreads } from "@/lib/worklist/message-triage";
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
 * (lib/clinical/doctor-tier.ts) first — see AuthorLabel in
 * components/care-message-thread.tsx. A patient/sponsor author has no actor.
 */
export type CareMessageAttachment = Tables<"care_message_attachments">;

export type CareMessage = Tables<"care_messages"> & {
  actor: {
    id: string;
    full_name: string | null;
    doctor_tier: Enums<"doctor_tier"> | null;
  } | null;
  attachments: CareMessageAttachment[];
};

export type CareMessageTemplate = Tables<"care_message_templates">;

const MESSAGE_SELECT = "*, attachments:care_message_attachments(*)";

type MessageActor = NonNullable<CareMessage["actor"]>;

/**
 * `actor_clinical_staff_id` used to be embedded directly via
 * `clinical_staff!care_messages_actor_clinical_staff_id_fkey(...)` — a
 * PostgREST embedded join, which resolves against `clinical_staff`'s OWN RLS,
 * not this query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would silently
 * come back null for every patient reading their own thread. Fetching the
 * actor separately from public.clinical_staff_directory (the safe-column
 * view every patient-facing clinical_staff read now uses) restores the same
 * attribution without reopening the column-exposure gap that migration
 * fixed.
 */
async function fetchMessageActors(
  supabase: ReturnType<typeof createClient>,
  actorIds: string[]
): Promise<Map<string, MessageActor>> {
  const actorById = new Map<string, MessageActor>();
  if (actorIds.length === 0) return actorById;
  const { data, error } = await supabase
    .from("clinical_staff_directory")
    .select("id, full_name, doctor_tier")
    .in("id", actorIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    actorById.set(row.id, {
      id: row.id,
      full_name: row.full_name,
      doctor_tier: row.doctor_tier,
    });
  }
  return actorById;
}
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

/**
 * All threads visible to the caller's org (staff worklist), ranked so the
 * patient waiting longest on a reply is first.
 *
 * `last_message_at desc` on its own surfaced the thread the care team had
 * just answered and buried the one nobody had picked up — the ordering was
 * pointing at finished work. compareThreads (lib/worklist/message-triage.ts)
 * puts threads awaiting the care team first, oldest wait first, and only then
 * falls back to recency. The fetch still asks Postgres for a deterministic
 * order so the client-side sort is stable.
 */
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
      return (data as unknown as CareThreadWithPatient[]).slice().sort(compareThreads);
    },
  });
}

/** SQLSTATE the audited care-inbox functions raise for someone who is neither the thread's patient nor org staff
 * (a supporter or a break-glass reader). Those readers still use the table's own select policy, so callers fall back. */
const NOT_AUTHORISED_CODE = "42501";

export function isNotAuthorisedForAuditedOpen(error: { code?: string } | null | undefined): boolean {
  return error?.code === NOT_AUTHORISED_CODE;
}

const rpcMessageSchema = z
  .object({
    id: z.string(),
    thread_id: z.string(),
    actor_clinical_staff_id: z.string().nullable().optional(),
    created_at: z.string(),
    attachments: z.array(z.object({ id: z.string() }).passthrough()).nullable().optional(),
  })
  .passthrough();

const rpcMessagesSchema = z.array(rpcMessageSchema);

type MessageRow = Tables<"care_messages"> & { attachments: CareMessageAttachment[] };

/** Parse the open_care_thread_audited jsonb array. Malformed output is an error, never a half-shown thread. */
function parseThreadRpcRows(raw: unknown): MessageRow[] {
  const parsed = rpcMessagesSchema.parse(raw ?? []);
  return parsed.map((row) => ({ ...row, attachments: row.attachments ?? [] }) as unknown as MessageRow);
}

async function fetchThreadRows(
  supabase: ReturnType<typeof createClient>,
  threadId: string
): Promise<MessageRow[]> {
  const { data: audited, error: auditedError } = await supabase.rpc("open_care_thread_audited", {
    p_thread: threadId,
  });
  if (!auditedError) return parseThreadRpcRows(audited);
  if (!isNotAuthorisedForAuditedOpen(auditedError)) throw auditedError;

  // A supporter or break-glass reader: not the patient, not org staff. They read the table under its own policy.
  const { data, error } = await supabase
    .from("care_messages")
    .select(MESSAGE_SELECT)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as unknown as MessageRow[];
}

export async function loadThreadMessages(
  supabase: ReturnType<typeof createClient>,
  threadId: string
): Promise<CareMessage[]> {
  const rows = await fetchThreadRows(supabase, threadId);
  const actorIds = Array.from(
    new Set(rows.map((row) => row.actor_clinical_staff_id).filter((id): id is string => !!id))
  );
  const actorById = await fetchMessageActors(supabase, actorIds);

  return rows.map((row) => ({
    ...row,
    actor: row.actor_clinical_staff_id ? (actorById.get(row.actor_clinical_staff_id) ?? null) : null,
  }));
}

const messageScopeSchema = z.object({
  organisation_id: z.string(),
  patient_id: z.string(),
  thread_id: z.string(),
});

export type CareMessageScope = z.infer<typeof messageScopeSchema>;

/** The org/patient/thread ids of a message. Staff cannot select message rows, so they use care_message_scope;
 * a supporter (42501) falls back to the direct read. */
export async function loadCareMessageScope(
  supabase: ReturnType<typeof createClient>,
  messageId: string
): Promise<CareMessageScope> {
  const { data: scope, error: scopeError } = await supabase.rpc("care_message_scope", { p_message: messageId });
  if (!scopeError) return messageScopeSchema.parse(scope);
  if (!isNotAuthorisedForAuditedOpen(scopeError)) throw scopeError;

  const { data, error } = await supabase
    .from("care_messages")
    .select("organisation_id, patient_id, thread_id")
    .eq("id", messageId)
    .single();
  if (error) throw error;
  return data;
}

/** Messages in a thread, oldest first (reading order). */
export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: ["care-messages", threadId],
    queryFn: async () => {
      const supabase = createClient();
      return loadThreadMessages(supabase, threadId as string);
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

/** The row staff can read: the model's input snapshot (the last messages, verbatim) is not readable by staff, so it is not here. */
export type CareMessageDraftReply = Omit<Tables<"care_message_draft_replies">, "input_snapshot">;

const DRAFT_REPLY_COLUMNS =
  "id, organisation_id, patient_id, thread_id, status, model_id, draft_text, needs_clinical_review, review_reason, error_message, generated_at";

/** The current AI-drafted reply suggestion for a thread, staff-only (RLS).
 * Null when none has been generated yet. */
export function useDraftReply(threadId: string | null) {
  return useQuery({
    queryKey: ["care-message-draft-reply", threadId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_message_draft_replies")
        .select(DRAFT_REPLY_COLUMNS)
        .eq("thread_id", threadId as string)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as CareMessageDraftReply | null;
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
      const message = await loadCareMessageScope(supabase, input.messageId);

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
