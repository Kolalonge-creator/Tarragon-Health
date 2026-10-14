"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { approveGrantSchema, cancelGrantSchema, confirmDonationSchema, describeFundError, nairaToKobo } from "@/lib/access-fund/admin";

export type FundActionState = { error?: string; message?: string } | undefined;
const PATH = "/admin/access-fund";
const bad = (e: { issues: { message: string }[] }): FundActionState => ({ error: e.issues[0]?.message ?? "Please check the form and try again." });

/** Operations saw the bank transfer arrive. The donation is then received and the event donation.received is sent. */
export async function confirmDonation(_prev: FundActionState, formData: FormData): Promise<FundActionState> {
  const parsed = confirmDonationSchema.safeParse({ id: formData.get("id"), bankReference: formData.get("bank_reference"), note: formData.get("note") });
  if (!parsed.success) return bad(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ops_confirm_donation_received", { p_id: parsed.data.id, p_bank_reference: parsed.data.bankReference, p_note: parsed.data.note });
  if (error) return { error: describeFundError(error.message) };
  revalidatePath(PATH);
  return { message: (data as { result?: string } | null)?.result === "received" ? "Marked as received." : "That gift was not waiting." };
}

/** Approves a grant against a published reason. The reason is required and kept in the audit log. */
export async function approveGrant(_prev: FundActionState, formData: FormData): Promise<FundActionState> {
  const parsed = approveGrantSchema.safeParse({
    patientId: formData.get("patient_id"), itemCode: formData.get("item_code"), naira: formData.get("naira"), criterion: formData.get("criterion"), note: formData.get("note"),
  });
  if (!parsed.success) return bad(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc("ops_approve_access_fund_grant", {
    p_patient: parsed.data.patientId, p_item_code: parsed.data.itemCode, p_ceiling_kobo: nairaToKobo(parsed.data.naira), p_criterion: parsed.data.criterion, p_note: parsed.data.note,
  });
  if (error) return { error: describeFundError(error.message) };
  revalidatePath(PATH);
  return { message: "Grant approved." };
}

export async function cancelGrant(_prev: FundActionState, formData: FormData): Promise<FundActionState> {
  const parsed = cancelGrantSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") });
  if (!parsed.success) return bad(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ops_cancel_access_fund_grant", { p_id: parsed.data.id, p_reason: parsed.data.reason });
  if (error) return { error: describeFundError(error.message) };
  const result = (data as { result?: string } | null)?.result;
  revalidatePath(PATH);
  if (result === "order_in_progress") return { error: "An order is open against this grant. Try again once it is paid or cancelled." };
  return { message: result === "cancelled" ? "Grant cancelled." : "That grant is no longer open." };
}

export async function runExpiry(): Promise<FundActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("expire_access_fund");
  if (error) return { error: describeFundError(error.message) };
  revalidatePath(PATH);
  const r = data as { pledges_lapsed?: number; grants_expired?: number } | null;
  return { message: `Pledges lapsed: ${r?.pledges_lapsed ?? 0}. Grants expired: ${r?.grants_expired ?? 0}.` };
}
