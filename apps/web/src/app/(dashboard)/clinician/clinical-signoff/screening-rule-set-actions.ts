"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";
import { readPendingScreeningRuleSet } from "@/lib/queries/pending-screening-rule-set-signoff";

/**
 * The Chief Medical Officer signs the screening rule set draft from the sign-off hub. Deliberate: the box must be ticked and the word SIGN
 * typed. Two further checks keep a stale or wrong form from signing something else: the id must be the draft the hub is showing right now,
 * and that draft must carry exactly the signed version's rules plus a pacing block (a draft that changes the rules is never signed here).
 * The database (sign_screening_rule_set) is the protection: it refuses anyone but the active CMO, then signs and activates in one step.
 */
const idSchema = z.string().uuid("That draft is not recognised. Nothing was signed.");

export async function signScreeningRuleSetAction(formData: FormData): Promise<void> {
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
  const id = idSchema.safeParse(formData.get("id") ?? "");
  if (!id.success) return finish(false, id.error.issues[0]?.message ?? "Nothing was signed.");
  const supabase = await createClient();
  const pending = await readPendingScreeningRuleSet(supabase);
  if (pending.failed) return finish(false, "The draft could not be read. Nothing was signed. Please try again.");
  if (pending.draftId !== id.data) return finish(false, "That draft is no longer the one waiting. Nothing was signed.");
  if (!pending.signable) return finish(false, "This draft changes the rules themselves, so it cannot be signed from here. Nothing was signed.");
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc("sign_screening_rule_set", { p_id: id.data });
  if (error) return finish(false, ["22023", "23514", "42501", "P0001"].includes(error.code ?? "") ? error.message : "Something went wrong. Nothing was signed. Please try again.");
  revalidatePath(path);
  return finish(true);
}
