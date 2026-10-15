"use server";

import { revalidatePath } from "next/cache";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { callLengthLimits, describeFollowupError, uuidSchema } from "@/lib/followups/followups";

export type ExtendState = { error?: string; message?: string } | undefined;

const extendResultSchema = z.object({
  planned_minutes: z.number().nullable(),
  extended_minutes: z.number(),
  calendar_conflict: z.boolean(),
});

/**
 * The doctor adds time to a call. The database allows only the assigned doctor, in 5 minute steps, up to the configured total, and
 * reports (but never blocks) a clash with the next booking. The summary page is deliberately NOT revalidated: re-rendering it would
 * re-read, and so re-audit, the patient summary for a button press (the same rule the queue's extend button follows).
 */
export async function extendCall(_prev: ExtendState, formData: FormData): Promise<ExtendState> {
  const encounter = uuidSchema.safeParse(String(formData.get("encounter_id") ?? ""));
  const minutes = Number(formData.get("minutes"));
  if (!encounter.success || !Number.isInteger(minutes) || minutes < 5 || minutes > callLengthLimits().maxExtension) {
    return { error: t("precall.extend_error", "en") };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("extend_encounter_call" as never, { p_encounter: encounter.data, p_extra_minutes: minutes } as never);
  if (error) return { error: describeFollowupError(error, t("precall.extend_error", "en")) };
  const parsed = extendResultSchema.safeParse(data);
  if (!parsed.success) return { error: t("precall.extend_error", "en") };
  revalidatePath("/clinician/consultations");
  return {
    message: parsed.data.calendar_conflict
      ? t("precall.extend_conflict", "en")
      : t("precall.extend_done", "en", { minutes: parsed.data.extended_minutes }),
  };
}
