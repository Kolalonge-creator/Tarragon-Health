"use server";

import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { t } from "@tarragon/i18n";
import { safetyConcernSchema } from "@/lib/clinician/queue-console";

export type SafetyConcernState = { error?: string; sent?: boolean; code?: string } | undefined;

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
  const aboutLead = formData.get("about_lead") === "yes";
  // Anonymous: no screen, no task and no id leave this function (they could name the person); the one-time follow-up code comes back once.
  if (formData.get("anonymous") === "yes") {
    const anon = await supabase.rpc("raise_anonymous_safety_concern", {
      p_category: parsed.data.category,
      p_severity: parsed.data.severity,
      p_description: parsed.data.description,
      p_about_lead: aboutLead,
    });
    if (anon.error || typeof anon.data !== "string") {
      const people = anon.error?.code === "54000" || anon.error?.code === "42501" || anon.error?.code === "22023";
      return { error: people && anon.error ? anon.error.message : t("concern.err.generic", "en") };
    }
    return { sent: true, code: anon.data };
  }
  const { error } = await supabase.rpc("raise_safety_concern", {
    p_category: parsed.data.category,
    p_severity: parsed.data.severity,
    p_description: parsed.data.description,
    p_screen: parsed.data.screen,
    p_task: parsed.data.taskId,
    p_about_lead: aboutLead,
  });
  if (error) {
    // 22023/54000/42501 carry sentences written for people; anything else is generic
    const people = error.code === "54000" || error.code === "42501" || error.code === "22023";
    return { error: people ? error.message : t("concern.err.generic", "en") };
  }
  return { sent: true };
}
