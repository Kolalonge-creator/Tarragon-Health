"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { assignDedicatedAccount } from "@/lib/paystack/dedicated-accounts";

export type DedicatedAccountState = { error?: string; message?: string } | undefined;

/**
 * Assigns the signed-in patient their own permanent Tarragon bank transfer
 * number — a one-time action per patient (patient_dedicated_accounts.
 * profile_id is unique). Once assigned it never changes, so a repeat call
 * is a friendly no-op rather than a second Paystack customer/account.
 */
export async function requestDedicatedAccountAction(): Promise<DedicatedAccountState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { error: "Not signed in" };

  const { data: existing } = await supabase
    .from("patient_dedicated_accounts")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (existing) {
    return { message: "You already have a transfer number." };
  }

  if (!isPaystackConfigured()) {
    return { error: "Bank transfer isn't set up yet — try card payment for now." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, full_name, phone")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id || !profile.full_name || !profile.phone) {
    return { error: "Add your name and phone number to your profile first." };
  }

  const result = await assignDedicatedAccount({
    email: user.email,
    fullName: profile.full_name,
    phone: profile.phone,
  });
  if (!result.ok) return { error: result.error };

  const { error: insertError } = await supabase.from("patient_dedicated_accounts").insert({
    organisation_id: profile.organisation_id,
    profile_id: user.id,
    paystack_customer_code: result.data.customerCode,
    paystack_dedicated_account_id: String(result.data.dedicatedAccountId),
    account_number: result.data.accountNumber,
    bank_name: result.data.bankName,
    bank_slug: result.data.bankSlug,
  });
  if (insertError) return { error: insertError.message };

  revalidatePath("/patient/subscription");
  revalidatePath("/patient");
  return { message: "Your Tarragon transfer number is ready." };
}
