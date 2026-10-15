"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Json } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { describeRpcError, handbackSchema, queueNextResultSchema } from "@/lib/clinician/written-questions";
import { t } from "@tarragon/i18n";
import { loose } from "@/lib/clinician/loose-client";
import {
  attemptsFromRows, completeTaskSchema, completionOptions, DEDICATED_FLOW_TASK_TYPES, SYSTEM_CLOSED_TASK_TYPES, uuidSchema, type AttemptRow,
} from "@/lib/clinician/queue-console";

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

/** The rows of the contact-attempt part of the form, in the order they appear (the form draws the required number plus one). */
function attemptRowsFromForm(formData: FormData, count: number): AttemptRow[] {
  const rows: AttemptRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      method: String(formData.get(`attempt_method_${i}`) ?? ""),
      at: String(formData.get(`attempt_at_${i}`) ?? ""),
      reached: formData.get(`attempt_reached_${i}`) === "on",
    });
  }
  return rows;
}

/**
 * Finish a held task with a coded outcome (S16-S20 D4). The code must be one this task type lists; a note is only a note; a
 * critical result closed by contact attempts carries the attempts. The database checks the same things against the system record
 * and refuses a lapsed hold.
 */
export async function completeTask(_prev: QueueActionState, formData: FormData): Promise<QueueActionState> {
  const note = String(formData.get("note") ?? "");
  const parsed = completeTaskSchema.safeParse({
    taskId: String(formData.get("task_id") ?? ""),
    code: String(formData.get("code") ?? ""),
    note: note === "" ? undefined : note,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("queue.err.check_form", "en") };
  const supabase = await createClient();
  // A task with its own completion flow is never closed here (it would pay the fee with no answer given). Row security returns
  // only a task I hold, so a missing row is "not yours", not "no such type".
  const held = await loose(supabase).from("clinical_tasks").select("type").eq("id", parsed.data.taskId).maybeSingle();
  if (held.error) return { error: t("queue.err.check_form", "en") };
  const type = (held.data as { type?: string } | null)?.type;
  if (type && (DEDICATED_FLOW_TASK_TYPES[type] || SYSTEM_CLOSED_TASK_TYPES[type])) return { error: t("task.err.dedicated_flow", "en") };
  const options = completionOptions(type ?? "");
  if (!options.codes.includes(parsed.data.code)) return { error: t("task.err.outcome_needed", "en") };
  const outcome: { [key: string]: Json } = { code: parsed.data.code };
  if (parsed.data.note) outcome["note"] = parsed.data.note;
  if (parsed.data.code === options.attemptsCode) {
    const attempts = attemptsFromRows(attemptRowsFromForm(formData, options.minAttempts + 1)).filter((a) => options.methods.includes(a.method));
    if (attempts.length < options.minAttempts) return { error: t("task.err.attempts_needed", "en", { count: options.minAttempts }) };
    outcome["attempts"] = attempts;
  }
  const { error } = await supabase.rpc("queue_complete", { p_task: parsed.data.taskId, p_outcome: outcome });
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
