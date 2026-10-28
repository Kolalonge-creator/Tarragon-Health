"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MSK_PROGRAMME_CODES } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";

/**
 * The Chief Medical Officer approves one pain programme's content version, or confirms its entry list, from the sign-off hub (S96). Runs only
 * when the CMO presses the button; the database function refuses anyone else (42501) and anything already decided. Approving content or
 * confirming a list switches nothing on: the guard `therapy_pain_enabled` also needs the two attestations and is flipped on the go-live page.
 */
const approveSchema = z.object({ code: z.enum(MSK_PROGRAMME_CODES), version: z.coerce.number().int().min(1).max(10_000) });

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> };

async function run(formData: FormData, fn: "approve_therapy_programme_version" | "confirm_therapy_exclusion_list"): Promise<void> {
  const path = "/clinician/clinical-signoff";
  const finish = async (ok: boolean, detail?: string): Promise<never> => {
    const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
    return redirect(`${path}?n=${n}`);
  };
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  if (formData.get("understood") === null) return finish(false, "Tick the checkbox first. Nothing was signed.");
  const input = approveSchema.safeParse({ code: formData.get("code"), version: formData.get("version") });
  if (!input.success) return finish(false, "That item was not recognised. Nothing was signed.");
  const supabase = await createClient();
  const { error } = await (supabase as unknown as Rpc).rpc(fn, { p_programme_code: input.data.code, p_version: input.data.version });
  if (error) return finish(false, ["22023", "42501"].includes(error.code ?? "") ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(path);
  return finish(true);
}

export async function approveMskProgrammeContentAction(formData: FormData): Promise<void> {
  return run(formData, "approve_therapy_programme_version");
}

export async function confirmMskEntryListAction(formData: FormData): Promise<void> {
  return run(formData, "confirm_therapy_exclusion_list");
}
