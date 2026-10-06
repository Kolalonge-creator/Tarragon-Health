"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describePayoutError, payoutIdSchema } from "@/lib/payouts/payouts";

export type PayoutActionState = { error?: string; message?: string } | undefined;
const PATH = "/admin/payouts";

function idFrom(formData: FormData): string | null {
  const id = payoutIdSchema.safeParse(String(formData.get("payout_id") ?? ""));
  return id.success ? id.data : null;
}

/** Builds this week's drafts now. `rebuild` replaces drafts that are still drafts; an approved payout is never touched. */
export async function buildPayoutDrafts(_prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("build_payout_drafts_now", { p_force: formData.get("rebuild") === "1" });
  if (error) return { error: describePayoutError(error.message) };
  revalidatePath(PATH);
  return { message: data === 0 ? "No new drafts. Anyone below the minimum carries over to next week." : `${data} draft${data === 1 ? "" : "s"} made.` };
}

export async function approvePayout(_prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const id = idFrom(formData);
  if (!id) return { error: "That payout could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_payout", { p_id: id });
  if (error) return { error: describePayoutError(error.message) };
  revalidatePath(PATH);
  return { message: "Approved. Press Send to move the money." };
}

export async function discardPayoutDraft(_prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const id = idFrom(formData);
  if (!id) return { error: "That payout could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_payout_draft", { p_id: id });
  if (error) return { error: describePayoutError(error.message) };
  revalidatePath(PATH);
  return { message: "Draft discarded. Their earnings stay unpaid and will be in the next draft." };
}

/** Sends one approved payout through the `payouts` function, which asks the database first and Paystack second. */
export async function sendPayout(_prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const id = idFrom(formData);
  if (!id) return { error: "That payout could not be found." };
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("payouts", { body: { action: "send", payout_id: id } });
  if (error) {
    // A non-2xx reply carries its JSON body on the error's context.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { error: describePayoutError((body as { error?: string } | null)?.error ?? error.message) };
  }
  revalidatePath(PATH);
  const status = (data as { transfer_status?: string } | null)?.transfer_status;
  return { message: status === "success" ? "Paid." : "Sent to Paystack. The bank confirms in a few minutes; this page will show Paid when it does." };
}

export async function retryPayout(_prev: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const id = idFrom(formData);
  if (!id) return { error: "That payout could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("retry_payout", { p_id: id });
  if (error) return { error: describePayoutError(error.message) };
  revalidatePath(PATH);
  return { message: "Ready to send again, to their current verified account. Press Send." };
}
