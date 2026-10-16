"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describeDisputeError, openDisputeSchema, withdrawDisputeSchema } from "@/lib/earnings/disputes";

export type EarningsDisputeState = { error?: string; message?: string } | undefined;
const PATH = "/clinician/earnings";

/**
 * One tap: question a single earnings line. The line is held out of the next payout while the rest still pays. The request id (made when
 * the form is drawn) makes a double tap open one question. The database checks that the line is the caller's own.
 */
export async function openEarningsDispute(_prev: EarningsDisputeState, formData: FormData): Promise<EarningsDisputeState> {
  const parsed = openDisputeSchema.safeParse({
    ledgerId: String(formData.get("ledger_id") ?? ""),
    reasonCode: String(formData.get("reason_code") ?? ""),
    note: String(formData.get("note") ?? ""),
    requestId: String(formData.get("request_id") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_earnings_dispute", {
    p_ledger: parsed.data.ledgerId,
    p_reason_code: parsed.data.reasonCode,
    p_request_id: parsed.data.requestId,
    ...(parsed.data.note ? { p_note: parsed.data.note } : {}),
  });
  if (error) return { error: describeDisputeError(error) };
  revalidatePath(PATH);
  revalidatePath("/clinician/payouts");
  return { message: "Sent. This line is on hold while finance looks at it; the rest of your earnings are paid as usual." };
}

export async function withdrawEarningsDispute(_prev: EarningsDisputeState, formData: FormData): Promise<EarningsDisputeState> {
  const parsed = withdrawDisputeSchema.safeParse({ disputeId: String(formData.get("dispute_id") ?? "") });
  if (!parsed.success) return { error: "That question could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_earnings_dispute", { p_id: parsed.data.disputeId });
  if (error) return { error: describeDisputeError(error) };
  revalidatePath(PATH);
  revalidatePath("/clinician/payouts");
  return { message: "Withdrawn. The line goes into your next payout." };
}
