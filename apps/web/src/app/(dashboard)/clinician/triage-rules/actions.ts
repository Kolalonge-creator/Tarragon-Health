"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";

/**
 * The Chief Medical Officer's two sign-off actions (S16b). Both only ever run when the CMO presses the button on
 * /clinician/triage-rules or /clinician/task-types; the database refuses anyone else (42501), so the check here is
 * a courtesy and a clear message, not the protection. A person-readable message from the database (codes 22023 and
 * 42501) is shown as written; anything else becomes a generic one.
 */
const noteSchema = z.string().trim().max(500).optional();

function back(path: string, key: "done" | "error", value: string): never {
  redirect(`${path}?${key}=${encodeURIComponent(value)}`);
}

function readable(error: { message: string; code?: string }): string {
  return error.code === "22023" || error.code === "42501" ? error.message : "Something went wrong. Nothing was changed. Please try again.";
}

export async function confirmTaskTypeAction(formData: FormData): Promise<void> {
  const path = "/clinician/task-types";
  if (!canAssignCases(await getCurrentClinicalStaff())) back(path, "error", "Only the Chief Medical Officer can do this.");
  const code = z.string().regex(/^[a-z][a-z0-9_]*$/).safeParse(formData.get("code"));
  if (!code.success) back(path, "error", "That task type was not recognised.");
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  const supabase = await createClient();
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc("confirm_task_type", { p_code: code.data, p_note: note.success ? note.data ?? null : null });
  if (error) back(path, "error", readable(error));
  revalidatePath(path);
  revalidatePath("/clinician/triage-rules");
  back(path, "done", "Confirmed. It is recorded with your name and the time.");
}

export async function approveRuleSetAction(formData: FormData): Promise<void> {
  const path = "/clinician/triage-rules";
  if (!canAssignCases(await getCurrentClinicalStaff())) back(path, "error", "Only the Chief Medical Officer can do this.");
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) back(path, "error", "That rule set was not recognised.");
  // Signing is deliberate: the box must be ticked and the typed word must match, so a stray press cannot sign.
  if (formData.get("understood") !== "on" || String(formData.get("typed") ?? "").trim().toUpperCase() !== "SIGN") {
    back(path, "error", "To sign, tick the box and type SIGN. Nothing was signed.");
  }
  const note = noteSchema.safeParse(formData.get("note") ?? undefined);
  const supabase = await createClient();
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc("approve_triage_rule_set", { p_id: id.data, p_note: note.success ? note.data ?? null : null });
  if (error) back(path, "error", readable(error));
  revalidatePath(path);
  back(path, "done", "Signed. New triage results now create clinical tasks.");
}
