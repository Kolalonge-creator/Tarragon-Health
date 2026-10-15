"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { noticeForError, pauseFormSchema, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/admin/ops/automations?n=${n}`);

/** Pauses or resumes one scheduled job. The database refuses non-admins, safety-critical jobs and Vercel crons; this only passes the form on. */
export async function setAutomationPausedAction(formData: FormData): Promise<void> {
  const parsed = pauseFormSchema.safeParse({
    job_name: formData.get("job_name"),
    paused: formData.get("paused"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return back("reason_short");
  const { error } = await loose(await createClient()).rpc("set_automation_paused", {
    p_job_name: parsed.data.job_name,
    p_paused: parsed.data.paused,
    p_reason: parsed.data.reason,
  });
  if (error) return back(noticeForError(error.code));
  return back(parsed.data.paused ? "paused" : "resumed");
}
