"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";
import { RED_OUTREACH_TASK_TYPE } from "@/lib/queries/pending-red-outreach-signoff";

/**
 * The Chief Medical Officer confirms the red-alert outreach task type from the sign-off hub (S13 R4, CMO Q11). Only ever runs when
 * the CMO presses the button; the database (confirm_task_type) refuses anyone else with 42501, so the check here is a courtesy.
 * Nothing is created by confirming: it only lets the timer open call-the-patient tasks from then on.
 */
const noteSchema = z.string().trim().max(500).optional();

export async function confirmRedOutreachAction(formData: FormData): Promise<void> {
  const path = "/clinician/clinical-signoff";
  const finish = async (ok: boolean, detail?: string): Promise<never> => {
    const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
    return redirect(`${path}?n=${n}`);
  };
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  if (formData.get("understood") === null) return finish(false, "Tick the checkbox first. Nothing was confirmed.");
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  const supabase = await createClient();
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc("confirm_task_type", { p_code: RED_OUTREACH_TASK_TYPE, p_note: note.success ? note.data ?? null : null });
  if (error) return finish(false, error.code === "22023" || error.code === "42501" ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(path);
  revalidatePath("/clinician/task-types");
  return finish(true);
}
