"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { nairaInputToKobo } from "@/lib/format-money";
import { adjustmentSchema, buildItemsFromForm, describeEarningsError, scheduleIdSchema } from "@/lib/earnings/earnings";

export type EarningsActionState = { error?: string; message?: string } | undefined;
const PATH = "/admin/earnings";

/** Saves the schedule form as a new draft, or into the draft it was opened from. The database checks the caller and every value again. */
export async function saveFeeScheduleDraft(_prev: EarningsActionState, formData: FormData): Promise<EarningsActionState> {
  const supabase = await createClient();
  // The task types come from the database, not from the form, so a tampered form cannot add or drop one.
  const types = await supabase.from("task_types").select("code").eq("is_active", true).order("code");
  if (types.error) return { error: "The task types could not be loaded. Please try again." };
  const built = buildItemsFromForm(formData, types.data.map((t) => t.code));
  if (!built.ok) return { error: built.error };
  const note = String(formData.get("note") ?? "").trim() || undefined;
  const draftId = String(formData.get("draft_id") ?? "").trim();
  if (draftId) {
    const id = scheduleIdSchema.safeParse(draftId);
    if (!id.success) return { error: "That draft could not be found." };
    const { error } = await supabase.rpc("update_fee_schedule_draft", { p_id: id.data, p_items: built.items, ...(note ? { p_note: note } : {}) });
    if (error) return { error: describeEarningsError(error) };
    revalidatePath(PATH);
    return { message: "Draft saved." };
  }
  const { error } = await supabase.rpc("create_fee_schedule_draft", { p_items: built.items, ...(note ? { p_note: note } : {}) });
  if (error) return { error: describeEarningsError(error) };
  revalidatePath(PATH);
  return { message: "Draft saved. Review it, then approve it for it to apply to new earnings." };
}

/** Approves a draft: it applies from now to work finished after this moment, and the previous schedule is closed. */
export async function approveFeeSchedule(_prev: EarningsActionState, formData: FormData): Promise<EarningsActionState> {
  const id = scheduleIdSchema.safeParse(String(formData.get("schedule_id") ?? ""));
  if (!id.success) return { error: "That draft could not be found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_fee_schedule", { p_id: id.data });
  if (error) return { error: describeEarningsError(error) };
  revalidatePath(PATH);
  const missing = (data as { task_types_without_fee?: string[] } | null)?.task_types_without_fee ?? [];
  return {
    message:
      missing.length > 0
        ? `Approved. These task types have no fee, so their lines will be flagged for you to correct: ${missing.join(", ")}.`
        : "Approved. It applies to work finished from now on.",
  };
}

export async function discardFeeScheduleDraft(_prev: EarningsActionState, formData: FormData): Promise<EarningsActionState> {
  const id = scheduleIdSchema.safeParse(String(formData.get("schedule_id") ?? ""));
  if (!id.success) return { error: "That draft could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_fee_schedule_draft", { p_id: id.data });
  if (error) return { error: describeEarningsError(error) };
  revalidatePath(PATH);
  return { message: "Draft discarded." };
}

/** Posts a correction to a contracted clinician's statement. The request id makes a double click post once. */
export async function postEarningsAdjustment(_prev: EarningsActionState, formData: FormData): Promise<EarningsActionState> {
  const parsed = adjustmentSchema.safeParse({
    clinicianId: String(formData.get("clinician_id") ?? ""),
    direction: String(formData.get("direction") ?? ""),
    corrects: String(formData.get("corrects") ?? "").trim() || undefined,
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  const kobo = nairaInputToKobo(formData.get("amount"));
  if (kobo === null || kobo === 0) return { error: "Please enter an amount in naira that is more than zero." };
  const requestId = String(formData.get("request_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_earnings_adjustment", {
    p_clinician: parsed.data.clinicianId,
    p_amount_kobo: parsed.data.direction === "add" ? kobo : -kobo,
    p_reason: parsed.data.reason,
    ...(parsed.data.corrects ? { p_corrects: parsed.data.corrects } : {}),
    ...(/^[0-9a-f-]{36}$/i.test(requestId) ? { p_request_id: requestId } : {}),
  });
  if (error) return { error: describeEarningsError(error) };
  revalidatePath(PATH);
  return { message: "Adjustment posted. The clinician has been told." };
}
