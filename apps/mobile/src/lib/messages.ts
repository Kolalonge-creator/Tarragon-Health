import { supabase } from "./supabase";
import type { Tables } from "@tarragon/shared";

export type CareThread = Tables<"care_message_threads">;
export type CareMessage = Tables<"care_messages"> & {
  actor: { full_name: string | null } | null;
};

type MessageActor = NonNullable<CareMessage["actor"]>;

/**
 * `actor_clinical_staff_id` used to be embedded directly via
 * `clinical_staff!care_messages_actor_clinical_staff_id_fkey(...)` — a
 * PostgREST embedded join, which resolves against `clinical_staff`'s OWN
 * RLS, not this query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every patient reading their own thread.
 * Fetching the actor separately from public.clinical_staff_directory (the
 * safe-column view every patient-facing clinical_staff read now uses)
 * restores the same attribution without reopening the column-exposure gap
 * that migration fixed. Mirrors
 * apps/web/src/lib/queries/care-messages.ts's fetchMessageActors.
 */
async function fetchMessageActors(actorIds: string[]): Promise<Map<string, MessageActor>> {
  const actorById = new Map<string, MessageActor>();
  if (actorIds.length === 0) return actorById;
  const { data, error } = await supabase.from("clinical_staff_directory").select("id, full_name").in("id", actorIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    actorById.set(row.id, { full_name: row.full_name });
  }
  return actorById;
}

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
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = data as unknown as (CareMessage & { actor_clinical_staff_id: string | null })[];
  const actorIds = Array.from(new Set(rows.map((row) => row.actor_clinical_staff_id).filter((id): id is string => !!id)));
  const actorById = await fetchMessageActors(actorIds);

  return rows.map((row) => ({
    ...row,
    actor: row.actor_clinical_staff_id ? (actorById.get(row.actor_clinical_staff_id) ?? null) : null,
  }));
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
