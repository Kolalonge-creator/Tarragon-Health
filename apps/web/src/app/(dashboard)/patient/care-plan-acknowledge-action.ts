"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Input = z.object({ revisionId: z.string().uuid() });

export type AcknowledgeCarePlanChangeResult = { ok: true } | { ok: false };

/**
 * PD-06 "Got it". Runs on the signed-in person's own session; the database function records the acknowledgement only when
 * that person IS the patient (a supporter acting for them is refused there, not just hidden here). Any error is a plain
 * failure, never shown as saved.
 */
export async function acknowledgeCarePlanChange(input: unknown): Promise<AcknowledgeCarePlanChangeResult> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("acknowledge_care_plan_revision", { p_revision: parsed.data.revisionId });
  if (error || data !== true) return { ok: false };
  revalidatePath("/patient/care");
  return { ok: true };
}
