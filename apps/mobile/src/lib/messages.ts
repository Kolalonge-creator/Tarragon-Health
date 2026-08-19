import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

export type CareThread = Tables<"care_message_threads">;
export type CareMessage = Tables<"care_messages"> & {
  actor: { full_name: string | null; credential_type: string | null; credential_number: string | null } | null;
};

const MESSAGE_SELECT =
  "*, actor:clinical_staff!care_messages_actor_clinical_staff_id_fkey(full_name, credential_type, credential_number)";

/** Mirrors useCareThreads in apps/web/src/lib/queries/care-messages.ts. */
export async function loadThreads(patientId: string): Promise<CareThread[]> {
  const { data, error } = await supabase
    .from("care_message_threads")
    .select("*")
    .eq("patient_id", patientId)
    .order("last_message_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function loadThreadMessages(threadId: string): Promise<CareMessage[]> {
  const { data, error } = await supabase
    .from("care_messages")
    .select(MESSAGE_SELECT)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as unknown as CareMessage[];
}

/**
 * Sending is NEVER a bare insert — care_messages' author fields are
 * server-derived by a BEFORE INSERT trigger (forge-proof attribution) and an
 * AFTER INSERT trigger bumps last_message_at, writes a timeline event, and
 * queues the "new_care_message" notification. Both RPCs mirror
 * useStartThread/usePostMessage in apps/web/src/lib/queries/care-messages.ts
 * exactly — same parameter names, since they're calling the same function.
 */
export async function startThread(subject: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("start_care_thread", {
    p_subject: subject,
    p_body: body,
  });
  if (error) throw error;
  return data as string;
}

export async function postMessage(threadId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("post_care_message", {
    p_thread_id: threadId,
    p_body: body,
  });
  if (error) throw error;
  return data as string;
}
