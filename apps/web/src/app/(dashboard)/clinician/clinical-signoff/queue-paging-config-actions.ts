"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";
import { activationRefusal } from "@/lib/queries/pending-queue-paging-config-signoff";

/**
 * OQ-451. The Chief Medical Officer signs the task layer configuration, or activates the paging delivery configuration, from the sign-off
 * hub. Only runs when the CMO presses the button; the database functions refuse anyone else (42501) and a version already signed or older
 * than the one in force. The activation is refused by the database, with a list of reasons, until every on-call clinician has passed the
 * readiness checklist (a working push subscription, a verified email, a test page acknowledged in the window). Nothing else calls these.
 */
const versionSchema = z.coerce.number().int().min(1).max(10_000);
const PATH = "/clinician/clinical-signoff";

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
const SAFE_CODES = new Set(["22023", "42501", "23514", "P0002"]);

const activationSchema = z.object({
  activated: z.boolean(),
  reasons: z.array(z.object({ code: z.string(), name: z.string().nullish(), gaps: z.array(z.string()).optional(), clinician_id: z.string().optional() })),
});

async function finish(ok: boolean, detail?: string): Promise<never> {
  const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
  return redirect(`${PATH}?n=${n}`);
}

async function guard(formData: FormData): Promise<number | null> {
  if (!canAssignCases(await getCurrentClinicalStaff())) {
    await finish(false, "Only the Chief Medical Officer can do this.");
    return null;
  }
  if (formData.get("understood") === null) {
    await finish(false, "Tick the checkbox first. Nothing was changed.");
    return null;
  }
  const version = versionSchema.safeParse(formData.get("version"));
  if (!version.success) {
    await finish(false, "That version was not recognised. Nothing was changed.");
    return null;
  }
  return version.data;
}

export async function signTaskLayerConfigAction(formData: FormData): Promise<void> {
  const version = await guard(formData);
  if (version === null) return;
  const supabase = (await createClient()) as unknown as Rpc;
  const { error } = await supabase.rpc("sign_queue_task_layer_config", { p_version: version });
  if (error) return finish(false, error.code && SAFE_CODES.has(error.code) ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  revalidatePath(PATH);
  return finish(true);
}

export async function activatePagingDeliveryConfigAction(formData: FormData): Promise<void> {
  const version = await guard(formData);
  if (version === null) return;
  const supabase = (await createClient()) as unknown as Rpc;
  const { data, error } = await supabase.rpc("activate_paging_delivery_config", { p_version: version });
  if (error) return finish(false, error.code && SAFE_CODES.has(error.code) ? error.message : "Something went wrong. Nothing was changed. Please try again.");
  const result = activationSchema.safeParse(data);
  // An answer we cannot read is never treated as a success.
  if (!result.success) return finish(false, "The database gave an answer this page could not read. Check whether it is active before trying again.");
  if (!result.data.activated) return finish(false, activationRefusal(result.data.reasons));
  revalidatePath(PATH);
  return finish(true);
}
