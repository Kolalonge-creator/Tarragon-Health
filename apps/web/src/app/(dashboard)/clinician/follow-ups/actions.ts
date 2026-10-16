"use server";

import { revalidatePath } from "next/cache";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { describeRpcError } from "@/lib/clinician/written-questions";
import { closeFollowUpSchema, followUpIdSchema } from "@/lib/clinician/follow-ups";

export type FollowUpActionState = { error?: string; message?: string } | undefined;

const PATH = "/clinician/follow-ups";

/** Mark a follow-up as seen. The database checks the follow-up is mine or tied to my patient. */
export async function acknowledgeFollowUp(_prev: FollowUpActionState, formData: FormData): Promise<FollowUpActionState> {
  const id = followUpIdSchema.safeParse(String(formData.get("id") ?? ""));
  if (!id.success) return { error: t("followups.err.not_found", "en") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_clinical_follow_up" as never, { p_id: id.data } as never);
  if (error) return { error: describeRpcError(error, t("followups.err.close_generic", "en")) };
  revalidatePath(PATH);
  return { message: "acknowledged" };
}

/** Close a follow-up. An outcome and a reason are both required, here and again by the database. */
export async function closeFollowUp(_prev: FollowUpActionState, formData: FormData): Promise<FollowUpActionState> {
  const parsed = closeFollowUpSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    outcome: String(formData.get("outcome") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? t("followups.err.check_form", "en") };
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "close_clinical_follow_up" as never,
    { p_id: parsed.data.id, p_outcome: parsed.data.outcome, p_reason: parsed.data.reason } as never,
  );
  if (error) return { error: describeRpcError(error, t("followups.err.close_generic", "en")) };
  revalidatePath(PATH);
  return { message: "closed" };
}
