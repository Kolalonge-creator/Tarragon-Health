"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";

/**
 * Chief Medical Officer oversight of personal thresholds: the monthly review (continue or end), ending one, and withdrawing the whole policy (the kill switch).
 * The database checks the role again and is the real protection; these checks give a clear message first.
 */
const PATH = "/clinician/threshold-overrides";
type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> };

async function finish(ok: boolean, detail?: string): Promise<never> {
  const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
  return redirect(`${PATH}?n=${n}`);
}
const shown = (e: { message: string; code?: string }): string => (["22023", "42501", "55000"].includes(e.code ?? "") ? e.message : "Something went wrong. Nothing was changed. Please try again.");

export async function reviewThresholdOverrideAction(formData: FormData): Promise<void> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  const id = z.string().uuid().safeParse(formData.get("override_id"));
  const outcome = z.enum(["continue", "revoke"]).safeParse(formData.get("outcome"));
  const note = z.string().trim().min(5, "Write a review note of at least 5 characters.").max(500).safeParse(formData.get("note") ?? "");
  if (!id.success || !outcome.success) return finish(false, "That review could not be read. Nothing was changed.");
  if (!note.success) return finish(false, `${note.error.issues[0]?.message ?? "Write a note."} Nothing was changed.`);
  const { error } = await ((await createClient()) as unknown as Rpc).rpc("review_threshold_override", { p_id: id.data, p_outcome: outcome.data, p_note: note.data });
  if (error) return finish(false, shown(error));
  revalidatePath(PATH);
  return finish(true);
}

/** Sign the personal-threshold policy from the sign-off hub: tick, type SIGN. */
export async function signThresholdPolicyAction(formData: FormData): Promise<void> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  const id = z.string().uuid().safeParse(formData.get("policy_id"));
  if (!id.success) return finish(false, "That policy version could not be read. Nothing was signed.");
  if (formData.get("understood") === null || String(formData.get("typed") ?? "").trim().toUpperCase() !== "SIGN") {
    return finish(false, formData.get("understood") === null ? "Tick the checkbox first. Nothing was signed." : "Type the word SIGN. Nothing was signed.");
  }
  const { error } = await ((await createClient()) as unknown as Rpc).rpc("sign_threshold_override_policy", { p_id: id.data, p_confirm: "SIGN" });
  if (error) return finish(false, shown(error));
  revalidatePath("/clinician/clinical-signoff");
  revalidatePath(PATH);
  return finish(true);
}

export async function withdrawThresholdPolicyAction(formData: FormData): Promise<void> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  const reason = z.string().trim().min(5, "Write a reason of at least 5 characters.").max(500).safeParse(formData.get("reason") ?? "");
  if (!reason.success) return finish(false, `${reason.error.issues[0]?.message ?? "Write a reason."} Nothing was changed.`);
  const { error } = await ((await createClient()) as unknown as Rpc).rpc("withdraw_threshold_override_policy", { p_reason: reason.data });
  if (error) return finish(false, shown(error));
  revalidatePath(PATH);
  return finish(true);
}
