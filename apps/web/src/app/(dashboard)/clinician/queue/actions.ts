"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describeRpcError, handbackSchema, queueNextResultSchema } from "@/lib/clinician/written-questions";
import { completeTaskSchema } from "@/lib/clinician/queue-console";

export type QueueActionState = { error?: string; message?: string } | undefined;

const QUEUE = "/clinician/queue";

/**
 * "Next task": the server picks and claims atomically, the clinician cannot browse or choose. Any task type the
 * clinician is eligible for. A claim sends them to the task; nothing waiting stays on the queue page with a notice.
 */
export async function takeNextTask(): Promise<QueueActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queue_next", {});
  if (error) return { error: describeRpcError(error, "The queue could not be opened. Please try again.") };
  const parsed = queueNextResultSchema.safeParse(data);
  if (!parsed.success) return { error: "The queue gave an answer this page could not read. Please try again." };
  revalidatePath(QUEUE);
  if (!parsed.data.task) redirect(`${QUEUE}?none=1`);
  redirect(`/clinician/tasks/${parsed.data.task.id}`);
}

/** One extension of the hold. The database says when it has been used. */
export async function extendClaim(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const taskId = String(formData.get("task_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return { error: "That task could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("queue_extend_claim", { p_task: taskId });
  if (error) {
    const message = error.message.includes("queue_extension_used")
      ? "You have already used your extra time on this task."
      : describeRpcError(error, "The hold could not be extended. Please try again.");
    return { error: message };
  }
  revalidatePath(QUEUE);
  revalidatePath(`/clinician/tasks/${taskId}`);
  return { message: "extended" };
}

/** Finish a held task. The outcome is a note of what was done; the database refuses it if the hold has lapsed. */
export async function completeTask(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const parsed = completeTaskSchema.safeParse({
    taskId: String(formData.get("task_id") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  const supabase = await createClient();
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
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
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
