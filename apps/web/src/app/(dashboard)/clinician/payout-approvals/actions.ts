"use server";

import { revalidatePath } from "next/cache";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { describePayoutError, payoutIdSchema } from "@/lib/payouts/payouts";

export type ApprovePayoutState = { error?: string; message?: string } | undefined;

/**
 * S36j: the Chief Medical Officer approves one payout draft. Runs with the signed-in session, never the service role. The database
 * is the protection (approver check, guard, not the payee, verified bank, ledger unchanged); the tier check here only gives a clear
 * message first. Sending, discarding and retrying stay with the admin.
 */
export async function approvePayoutAsCmo(_prev: ApprovePayoutState, formData: FormData): Promise<ApprovePayoutState> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return { error: describePayoutError("payout_not_authorised") };
  const id = payoutIdSchema.safeParse(String(formData.get("payout_id") ?? ""));
  if (!id.success) return { error: "That payout could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_payout", { p_id: id.data });
  if (error) return { error: describePayoutError(error.message) };
  revalidatePath("/clinician/payout-approvals");
  return { message: "Approved. The founder sends it." };
}
