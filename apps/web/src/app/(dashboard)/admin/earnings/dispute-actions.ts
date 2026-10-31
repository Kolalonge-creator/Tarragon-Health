"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseMoneyInput } from "@/lib/finance/money-input";
import { describeDisputeError, holdDecisionSchema, resolveDisputeSchema, withholdingNoteSchema } from "@/lib/earnings/disputes";

export type DisputeActionState = { error?: string; message?: string } | undefined;
const PATH = "/admin/earnings/disputes";

/**
 * Finance answers a clinician's question about one earnings line: add a correction (positive or negative, pointing at that line) or
 * turn it down with a reason. Either way the line is released from the hold. The database checks the role and every value again.
 */
export async function resolveEarningsDispute(_prev: DisputeActionState, formData: FormData): Promise<DisputeActionState> {
  const parsed = resolveDisputeSchema.safeParse({
    resolution: String(formData.get("resolution") ?? ""),
    disputeId: String(formData.get("dispute_id") ?? ""),
    direction: String(formData.get("direction") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  const supabase = await createClient();
  if (parsed.data.resolution === "adjusted") {
    const amount = parseMoneyInput(String(formData.get("amount") ?? ""), { allowZero: false });
    if (!amount.ok) return { error: amount.error };
    const kobo = amount.minor;
    const { error } = await supabase.rpc("resolve_earnings_dispute", {
      p_id: parsed.data.disputeId,
      p_resolution: "adjusted",
      p_amount_kobo: parsed.data.direction === "add" ? kobo : -kobo,
      p_note: parsed.data.note,
    });
    if (error) return { error: describeDisputeError(error) };
  } else {
    const { error } = await supabase.rpc("resolve_earnings_dispute", { p_id: parsed.data.disputeId, p_resolution: "rejected", p_note: parsed.data.note });
    if (error) return { error: describeDisputeError(error) };
  }
  revalidatePath(PATH);
  revalidatePath("/admin/payouts");
  return { message: "Answered. The line is released and the clinician has been told." };
}

/** Releases or denies a pilot-minimum top-up that the activity check held. A release posts the top-up straight away. */
export async function decideTopupHold(_prev: DisputeActionState, formData: FormData): Promise<DisputeActionState> {
  const parsed = holdDecisionSchema.safeParse({
    holdId: String(formData.get("hold_id") ?? ""),
    decision: String(formData.get("decision") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_topup_hold", { p_id: parsed.data.holdId, p_decision: parsed.data.decision, p_note: parsed.data.note });
  if (error) return { error: describeDisputeError(error) };
  revalidatePath(PATH);
  return { message: parsed.data.decision === "released" ? "Released. The top-up has been posted." : "Denied. No top-up is posted for those hours." };
}

/** Types in a withholding amount (naira) on a draft payout. Stored as entered; nothing calculates it (D-09). Zero clears it. */
export async function setPayoutWithholding(_prev: DisputeActionState, formData: FormData): Promise<DisputeActionState> {
  const payoutId = String(formData.get("payout_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(payoutId)) return { error: "That payout could not be found." };
  const raw = String(formData.get("withholding") ?? "").trim();
  // Blank clears it. Anything typed is read exactly or refused with the reason, never rounded or guessed.
  const amount = raw === "" ? ({ ok: true, minor: 0 } as const) : parseMoneyInput(raw);
  if (!amount.ok) return { error: `Withholding: ${amount.error}` };
  const kobo = amount.minor;
  const note = withholdingNoteSchema.safeParse(String(formData.get("note") ?? ""));
  if (!note.success) return { error: "Please keep the note under 1,000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_payout_withholding", { p_id: payoutId, p_withholding_kobo: kobo, ...(note.data ? { p_note: note.data } : {}) });
  if (error) return { error: describeDisputeError(error) };
  revalidatePath("/admin/payouts");
  return { message: kobo === 0 ? "Withholding cleared." : "Withholding saved. It is shown on the statement; it is not calculated." };
}
