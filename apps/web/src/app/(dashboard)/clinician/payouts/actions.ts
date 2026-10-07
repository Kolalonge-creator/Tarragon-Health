"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bankFormSchema, describePayoutError, taxProfileSchema } from "@/lib/payouts/payouts";

export type BankActionState = { error?: string; message?: string; verified?: boolean } | undefined;
const PATH = "/clinician/payouts";

/**
 * Adds where the clinician is paid. The `payouts` function asks Paystack for the name on the account and the database compares it with
 * the credentialed name; only a match makes the account usable. The full number is passed once and never stored.
 */
export async function saveBankAccount(_prev: BankActionState, formData: FormData): Promise<BankActionState> {
  const parsed = bankFormSchema.safeParse({ bankCode: String(formData.get("bank_code") ?? ""), accountNumber: String(formData.get("account_number") ?? "").replace(/\s+/g, "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("payouts", { body: { action: "verify_bank", bank_code: parsed.data.bankCode, account_number: parsed.data.accountNumber } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { error: describePayoutError((body as { error?: string } | null)?.error ?? error.message) };
  }
  revalidatePath(PATH);
  const r = data as { verified?: boolean; resolved_name?: string };
  if (r.verified) return { verified: true, message: `Verified. The account is in the name ${r.resolved_name}.` };
  return {
    verified: false,
    error: `The bank says this account is in the name ${r.resolved_name}, which does not match the name on your registration. Please use an account in your own name, or ask us to correct your registered name.`,
  };
}

/** Stores the details needed for withholding tax reporting. Nothing is calculated or deducted here (D-09). */
export async function saveTaxProfile(_prev: BankActionState, formData: FormData): Promise<BankActionState> {
  const parsed = taxProfileSchema.safeParse({
    tin: String(formData.get("tin") ?? ""),
    status: String(formData.get("status") ?? "unknown"),
    registeredName: String(formData.get("registered_name") ?? ""),
    vat: formData.get("vat") === "on",
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_my_tax_profile", {
    p_tin: parsed.data.tin,
    p_status: parsed.data.status,
    p_registered_name: parsed.data.registeredName,
    p_vat: parsed.data.vat,
    p_note: parsed.data.note,
  });
  if (error) return { error: describePayoutError(error.message) };
  revalidatePath(PATH);
  return { message: "Saved. We use this only to meet our tax reporting duties." };
}
