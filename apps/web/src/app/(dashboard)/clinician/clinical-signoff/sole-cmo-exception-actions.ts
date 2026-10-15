"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";
import { SOLE_CMO_EXCEPTION_COMPETENCY } from "@/lib/queries/pending-sole-cmo-exception";

/**
 * The Chief Medical Officer signs the sole-CMO on-call exception from the sign-off hub. Deliberate: the box must be ticked, the word SIGN typed
 * and a reason of at least 40 characters written. The database (sign_sole_cmo_exception) is the protection: it refuses anyone but the CMO,
 * refuses while a second active CMO exists, and enforces the reason length; the checks here only give a clear message first.
 */
const reasonSchema = z.string().trim().min(40, "Write the reason in at least 40 characters.").max(1000);

export async function signSoleCmoExceptionAction(formData: FormData): Promise<void> {
  const path = "/clinician/clinical-signoff";
  const finish = async (ok: boolean, detail?: string): Promise<never> => {
    const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
    return redirect(`${path}?n=${n}`);
  };
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  const typed = String(formData.get("typed") ?? "").trim().toUpperCase();
  if (formData.get("understood") === null || typed !== "SIGN") {
    return finish(false, formData.get("understood") === null ? "Tick the checkbox first. Nothing was signed." : "Type the word SIGN. Nothing was signed.");
  }
  const reason = reasonSchema.safeParse(formData.get("reason") ?? "");
  if (!reason.success) return finish(false, `${reason.error.issues[0]?.message ?? "Write a reason."} Nothing was signed.`);
  const supabase = await createClient();
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc("sign_sole_cmo_exception", { p_competency: SOLE_CMO_EXCEPTION_COMPETENCY, p_reason: reason.data, p_confirm: "SIGN" });
  if (error) return finish(false, ["22023", "23514", "42501"].includes(error.code ?? "") ? error.message : "Something went wrong. Nothing was signed. Please try again.");
  revalidatePath(path);
  return finish(true);
}
