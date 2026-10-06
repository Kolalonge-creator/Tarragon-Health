"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { looseRpc } from "@/lib/clinician/loose-rpc";
import {
  answerWrittenQuestionSchema,
  claimRedirectPath,
  describeRpcError,
  handbackSchema,
  queueNextResultSchema,
} from "@/lib/clinician/written-questions";

export type WrittenQuestionActionState = { error?: string; message?: string } | undefined;

const BASE = "/clinician/async-consults";

/**
 * "Take the next task" (S17 bridge until the full Next-task console). The server picks and claims atomically; the
 * clinician cannot browse or choose. A task that is not a written question is never dropped: the redirect carries it
 * to a notice that says it is held and can be handed back.
 */
export async function takeNextTask(): Promise<WrittenQuestionActionState> {
  const supabase = await createClient();
  const { data, error } = await looseRpc(supabase)("queue_next");
  if (error) return { error: describeRpcError(error, "The queue could not be opened. Please try again.") };
  const parsed = queueNextResultSchema.safeParse(data);
  if (!parsed.success) return { error: "The queue gave an answer this page could not read. Please try again." };
  revalidatePath(BASE);
  redirect(claimRedirectPath(parsed.data, BASE));
}

/** Hands a held task back to the queue (any task type). */
export async function handBackTask(
  _prev: WrittenQuestionActionState,
  formData: FormData,
): Promise<WrittenQuestionActionState> {
  const parsed = handbackSchema.safeParse({
    taskId: String(formData.get("task_id") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };

  const supabase = await createClient();
  const { error } = await looseRpc(supabase)("queue_handback", {
    p_task: parsed.data.taskId,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { error: describeRpcError(error) };
  revalidatePath(BASE);
  redirect(BASE);
}

/**
 * Sends the reply. There is no diagnosis field anywhere: the clinician attests that they have not made one, and
 * the attestation is checked here before the database is called at all.
 */
export async function answerWrittenQuestion(
  _prev: WrittenQuestionActionState,
  formData: FormData,
): Promise<WrittenQuestionActionState> {
  const parsed = answerWrittenQuestionSchema.safeParse({
    consultId: String(formData.get("consult_id") ?? ""),
    kind: String(formData.get("kind") ?? ""),
    body: String(formData.get("body") ?? ""),
    attested: formData.get("attested") === "on" || formData.get("attested") === "true",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the reply and try again." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_written_question", {
    p_consult: parsed.data.consultId,
    p_kind: parsed.data.kind,
    p_body: parsed.data.body,
    p_attested: parsed.data.attested,
  });
  if (error) return { error: describeRpcError(error) };
  revalidatePath(BASE);
  return {
    message:
      parsed.data.kind === "needs_call"
        ? "Sent. A call task has been created and the patient has been told they will be called."
        : "Reply sent to the patient.",
  };
}
