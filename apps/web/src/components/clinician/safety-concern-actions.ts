"use server";

import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { t } from "@tarragon/i18n";
import { safetyConcernSchema } from "@/lib/clinician/queue-console";

export type SafetyConcernState = { error?: string; sent?: boolean } | undefined;

/** Raises a safety concern with the clinical lead. The database applies the daily limit and tells the leads. */
export async function raiseSafetyConcern(_prev: SafetyConcernState, formData: FormData): Promise<SafetyConcernState> {
  const parsed = safetyConcernSchema.safeParse({
    category: String(formData.get("category") ?? ""),
    severity: String(formData.get("severity") ?? ""),
    description: String(formData.get("description") ?? ""),
    screen: String(formData.get("screen") ?? "").slice(0, 100) || undefined,
    taskId: String(formData.get("task_id") ?? "") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("queue.err.check_form", "en") };
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("raise_safety_concern", {
    p_category: parsed.data.category,
    p_severity: parsed.data.severity,
    p_description: parsed.data.description,
    p_screen: parsed.data.screen,
    p_task: parsed.data.taskId,
  });
  if (error) {
    // 22023/54000/42501 carry sentences written for people; anything else is generic
    const people = error.code === "54000" || error.code === "42501" || error.code === "22023";
    return { error: people ? error.message : t("concern.err.generic", "en") };
  }
  return { sent: true };
}
