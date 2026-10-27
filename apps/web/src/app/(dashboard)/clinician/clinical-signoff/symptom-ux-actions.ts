"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";

/**
 * The Chief Medical Officer signs one of the symptom checker's assessment-experience configs (follow-up timing, the describe-it words, the
 * "Why this result" reasons, the safety-net lines) from the sign-off hub. Only runs when the CMO presses the button; the database function
 * refuses anyone else (42501) and a version already signed. Signing alone changes nothing a patient sees until the signed text is also copied
 * into the app bundle in a release (the app compares the two and keeps the safe default on any difference), and the symptom checker itself stays
 * behind its own go-live guard.
 */
const inputSchema = z.object({ kind: z.enum(["checkback", "describe", "explainer", "safety_net"]), version: z.coerce.number().int().min(1).max(10_000) });

export async function signSymptomUxConfigAction(formData: FormData): Promise<void> {
  const path = "/clinician/clinical-signoff";
  const finish = async (ok: boolean, detail?: string): Promise<never> => {
    const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
    return redirect(`${path}?n=${n}`);
  };
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  if (formData.get("understood") === null) return finish(false, "Tick the checkbox first. Nothing was signed.");
  const input = inputSchema.safeParse({ kind: formData.get("kind"), version: formData.get("version") });
  if (!input.success) return finish(false, "That item was not recognised. Nothing was signed.");
  const supabase = await createClient();
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> }).rpc(
    "sign_symptom_ux_config",
    { p_kind: input.data.kind, p_version: input.data.version },
  );
  if (error) return finish(false, ["22023", "42501", "23514", "P0002"].includes(error.code ?? "") ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(path);
  return finish(true);
}
