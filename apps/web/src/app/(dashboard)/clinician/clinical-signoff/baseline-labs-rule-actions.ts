"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";

/**
 * The Chief Medical Officer signs the baseline-labs prescribing rule from the sign-off hub. Only runs when the CMO presses the button; the database
 * function refuses anyone else (42501) and a version already signed. Until signed, the prescribing check does nothing for anyone.
 */
const versionSchema = z.coerce.number().int().min(1).max(10_000);

export async function signBaselineLabsRuleAction(formData: FormData): Promise<void> {
  const path = "/clinician/clinical-signoff";
  const finish = async (ok: boolean, detail?: string): Promise<never> => {
    const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
    return redirect(`${path}?n=${n}`);
  };
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  if (formData.get("understood") === null) return finish(false, "Tick the checkbox first. Nothing was signed.");
  const version = versionSchema.safeParse(formData.get("version"));
  if (!version.success) return finish(false, "That version was not recognised. Nothing was signed.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_baseline_labs_rule_config", { p_version: version.data });
  if (error) return finish(false, ["22023", "42501", "23514", "P0002"].includes(error.code ?? "") ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(path);
  return finish(true);
}
