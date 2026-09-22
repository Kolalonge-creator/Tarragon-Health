"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { initiatePlatformCreditTopupCheckout } from "@/lib/billing/platform-credit-checkout";
import { isPlatformModuleEnabled, PLATFORM_CREDIT_TOPUPS_DISABLED_MESSAGE } from "@/lib/platform-modules";
import { nairaToKobo } from "@tarragon/shared";

export type PlatformCreditActionState = { error?: string; message?: string } | undefined;

/**
 * Tops up the caller's own platform credit balance (or, if patientId is
 * given, a patient who has linked them via profile_access — same authority
 * check purchase_care_voucher already uses). record_platform_credit_topup_intent
 * prices and bounds-checks the amount server-side; this only starts the
 * Paystack redirect. Crediting the balance happens in
 * private.apply_platform_credit_topup_payment once the webhook's insert into
 * payment_transactions lands — never here, and never before the charge is
 * real.
 *
 * Checks the platform_credit_topups module before ever calling the RPC, so a
 * disabled kill switch reads here as this action's own clear, patient-facing
 * message rather than the RPC's generic exception text — the RPC itself
 * still refuses independently either way (see lib/platform-modules.ts's
 * "never the ONLY check" rule).
 */
export async function topUpPlatformCredit(
  _prevState: PlatformCreditActionState,
  formData: FormData,
): Promise<PlatformCreditActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!user.email) return { error: "Your account needs an email on file to fund your balance." };

  if (!(await isPlatformModuleEnabled("platform_credit_topups"))) {
    return { error: PLATFORM_CREDIT_TOPUPS_DISABLED_MESSAGE };
  }

  const patientId = (formData.get("patientId") as string) || user.id;
  const amountNaira = Number(formData.get("amountNaira"));
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
    return { error: "Enter how much you'd like to add." };
  }
  const amountKobo = nairaToKobo(amountNaira);

  const supabase = await createClient();
  const { data: intentId, error: intentError } = await supabase.rpc(
    "record_platform_credit_topup_intent",
    { p_patient_id: patientId, p_amount_kobo: amountKobo },
  );
  if (intentError || !intentId) {
    return { error: intentError?.message ?? "Could not start this top-up" };
  }

  const { data: intent, error: loadError } = await supabase
    .from("platform_credit_topup_intents")
    .select("id, organisation_id, patient_id, amount_kobo")
    .eq("id", intentId)
    .single();
  if (loadError || !intent) {
    return { error: loadError?.message ?? "Could not load the top-up you just started" };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiatePlatformCreditTopupCheckout({
    topupIntentId: intent.id,
    organisationId: intent.organisation_id,
    patientId: intent.patient_id,
    amountKobo: intent.amount_kobo,
    email: user.email,
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}
