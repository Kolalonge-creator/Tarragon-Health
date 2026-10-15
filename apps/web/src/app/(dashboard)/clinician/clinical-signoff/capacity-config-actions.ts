"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";

/**
 * The Chief Medical Officer signs the capacity and cover configuration (the intake gate, the hard rest rule and the fire drills) or the pilot
 * lead cap from the sign-off hub (S16-S20 Stage 5). Only runs when the CMO presses the button; the database functions refuse anyone else
 * (42501) and refuse a version already signed or older than the one in force. Nothing else calls these.
 */
const versionSchema = z.coerce.number().int().min(1).max(10_000);
const FN = { capacity: "sign_capacity_cover_config", lead: "sign_lead_config" } as const;

async function sign(kind: keyof typeof FN, formData: FormData): Promise<void> {
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
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc(FN[kind], { p_version: version.data });
  if (error) return finish(false, error.code === "22023" || error.code === "42501" || error.code === "23514" || error.code === "P0002" ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(path);
  return finish(true);
}

export async function signCapacityConfigAction(formData: FormData): Promise<void> {
  return sign("capacity", formData);
}

export async function signLeadConfigAction(formData: FormData): Promise<void> {
  return sign("lead", formData);
}
