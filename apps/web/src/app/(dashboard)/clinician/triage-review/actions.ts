"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AGREEMENTS } from "@/lib/triage-accuracy/report";

const schema = z.object({ taskId: z.string().uuid(), agreement: z.enum(AGREEMENTS) });
const BACK = "/clinician/triage-review";

/**
 * Record whether the automatic grade was right for a task the clinician completed. It never blocks anything: it only adds one row. The database
 * checks that the caller completed that task, that the answer can be true for the grade, and that the capture is switched on.
 */
export async function recordTriageReviewAction(formData: FormData): Promise<void> {
  const p = schema.safeParse({ taskId: formData.get("taskId"), agreement: formData.get("agreement") });
  if (!p.success) redirect(`${BACK}?m=invalid`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_triage_review", { p_task: p.data.taskId, p_agreement: p.data.agreement });
  const status = typeof data === "object" && data !== null && "status" in data ? String((data as { status: unknown }).status) : "";
  if (error || status !== "ok") redirect(`${BACK}?m=${status === "not_available" ? "off" : "refused"}`);
  revalidatePath(BACK);
  redirect(`${BACK}?m=saved`);
}
