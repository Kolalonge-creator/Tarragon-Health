"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";

/**
 * The Chief Medical Officer switches unified red-event paging on or off from the sign-off hub (S19d). Only runs when the CMO presses the button.
 * The database functions refuse anyone else (42501) and refuse switching on without the test-pack confirmation (22023); nothing else calls
 * them, and nothing switches this on automatically. Switching off never touches pages that are already open.
 */
const versionSchema = z.coerce.number().int().min(1).max(10_000);
type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> };

async function finish(path: string, ok: boolean, detail?: string): Promise<never> {
  const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
  return redirect(`${path}?n=${n}`);
}

export async function switchOnUnifiedRedPagingAction(formData: FormData): Promise<void> {
  const path = "/clinician/clinical-signoff";
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(path, false, "Only the Chief Medical Officer can do this.");
  if (formData.get("understood") === null) return finish(path, false, "Tick the checkbox first. Nothing was switched on.");
  if (formData.get("test_pack_run") === null) return finish(path, false, "Confirm that you ran the staging test pack first. Nothing was switched on.");
  const version = versionSchema.safeParse(formData.get("version"));
  if (!version.success) return finish(path, false, "That version was not recognised. Nothing was switched on.");
  const supabase = await createClient();
  const { error } = await (supabase as unknown as Rpc).rpc("sign_unified_red_paging_config", { p_version: version.data, p_test_pack_run: true });
  if (error) return finish(path, false, error.code === "22023" || error.code === "42501" || error.code === "23514" || error.code === "P0002" ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(path);
  return finish(path, true);
}

export async function switchOffUnifiedRedPagingAction(): Promise<void> {
  const path = "/clinician/clinical-signoff";
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(path, false, "Only the Chief Medical Officer can do this.");
  const supabase = await createClient();
  const { error } = await (supabase as unknown as Rpc).rpc("switch_off_unified_red_paging");
  if (error) return finish(path, false, error.code === "42501" ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(path);
  return finish(path, true);
}
