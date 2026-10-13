"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

/**
 * "Run the check now": starts one canary run (public.chain_canary_run_now, admin or the active CMO, once per 15 minutes). The next
 * scheduled tick judges it. The result travels as one of three fixed words in the address, never free text.
 */
export async function runCanaryNowAction(form: FormData): Promise<void> {
  const to = form.get("from") === "clinician" ? "/clinician/chain-health" : "/admin/ops/chain-health";
  const profile = await getCurrentProfile();
  const staff = profile?.role === "clinician" ? await getCurrentClinicalStaff() : null;
  const allowed = profile?.role === "admin" || staff?.doctor_tier === "chief_medical_officer";
  if (!allowed) return redirect(`${to}?r=failed`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("chain_canary_run_now");
  revalidatePath(to);
  if (error?.code === "22023") return redirect(`${to}?r=wait`);
  return redirect(`${to}?r=${error ? "failed" : "started"}`);
}
