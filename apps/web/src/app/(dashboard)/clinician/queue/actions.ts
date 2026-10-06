"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describeRpcError, handbackSchema, queueNextResultSchema } from "@/lib/clinician/written-questions";
import { t } from "@tarragon/i18n";
import { loose } from "@/lib/clinician/loose-client";
import { completeTaskSchema, DEDICATED_FLOW_TASK_TYPES, uuidSchema } from "@/lib/clinician/queue-console";

export type QueueActionState = { error?: string; message?: string; expiresAt?: string } | undefined;

const QUEUE = "/clinician/queue";

/**
 * "Next task": the server picks and claims atomically, the clinician cannot browse or choose. Any task type the
 * clinician is eligible for. A claim sends them to the task; nothing waiting stays on the queue page with a notice.
 */
export async function takeNextTask(): Promise<QueueActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queue_next", {});
  if (error) return { error: describeRpcError(error, t("queue.err.open", "en")) };
  const parsed = queueNextResultSchema.safeParse(data);
  if (!parsed.success) return { error: t("queue.err.unreadable", "en") };
  revalidatePath(QUEUE);
  if (!parsed.data.task) redirect(`${QUEUE}?none=1`);
  redirect(`/clinician/tasks/${parsed.data.task.id}`);
}

/** One extension of the hold. The database says when it has been used. */
export async function extendClaim(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const id = uuidSchema.safeParse(String(formData.get("task_id") ?? ""));
  if (!id.success) return { error: t("queue.err.task_not_found", "en") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queue_extend_claim", { p_task: id.data });
  if (error) {
    const message = error.message.includes("queue_extension_used")
      ? t("queue.err.extension_used", "en")
      : describeRpcError(error, t("queue.err.extend", "en"));
    return { error: message };
  }
  // The task page is deliberately NOT revalidated: re-rendering it would re-read, and so re-audit, the patient summary
  // for a button press. The new expiry comes back in the answer and the form shows it.
  revalidatePath(QUEUE);
  return { message: "extended", expiresAt: typeof data === "string" ? data : undefined };
}

/** Finish a held task. The outcome is a note of what was done; the database refuses it if the hold has lapsed. */
export async function completeTask(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const parsed = completeTaskSchema.safeParse({
    taskId: String(formData.get("task_id") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("queue.err.check_form", "en") };
  const supabase = await createClient();
  // A task with its own completion flow is never closed with a free-text note (it would pay the fee with no answer given).
  // Row security returns only a task I hold, so a missing row is "not yours", not "no such type".
  const held = await loose(supabase).from("clinical_tasks").select("type").eq("id", parsed.data.taskId).maybeSingle();
  if (held.error) return { error: t("queue.err.check_form", "en") };
  const type = (held.data as { type?: string } | null)?.type;
  if (type && DEDICATED_FLOW_TASK_TYPES[type]) return { error: t("task.err.dedicated_flow", "en") };
  const { error } = await supabase.rpc("queue_complete", {
    p_task: parsed.data.taskId,
    p_outcome: { kind: "completed", note: parsed.data.note },
  });
  if (error) return { error: describeRpcError(error) };
  revalidatePath(QUEUE);
  redirect(`${QUEUE}?done=1`);
}

/** Hand a held task back with a reason. */
export async function handBack(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const parsed = handbackSchema.safeParse({
    taskId: String(formData.get("task_id") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("queue.err.check_form", "en") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("queue_handback", {
    p_task: parsed.data.taskId,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note,
  });
  if (error) return { error: describeRpcError(error) };
  revalidatePath(QUEUE);
  redirect(`${QUEUE}?handed_back=1`);
}
