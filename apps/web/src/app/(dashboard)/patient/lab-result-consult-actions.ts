"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";
import type { Currency } from "@tarragon/shared";

const requestSchema = z.object({
  labOrderId: z.string().uuid().optional(),
});

export type RequestLabResultConsultState = { error: string } | undefined;

/**
 * Patient pays the one-off self-arranged lab-result consultation fee (founder
 * rule, 2026-08-30): a lab_result_consult_requests row is created (amount
 * pinned server-side by private.pin_lab_result_consult_amount from the price
 * book — nothing the client sends sets the price) and the browser is
 * redirected to hosted checkout. Once the webhook confirms payment
 * ('payment_confirmed'), the credit is ready to be consumed by exactly one
 * self-arranged upload via public.claim_lab_result_consult_credit — see
 * uploadResultDocumentAsPatient in @/lib/lab-results/actions.
 *
 * labOrderId is optional: naming one ties the fee (and the eventual upload)
 * to that specific self-arranged order; omitting it pays a "loose" credit a
 * patient can use for any result with no prior order on file. Either way, a
 * network-billed (fulfilment='partner') order never reaches this action in
 * the first place — the pin trigger rejects linking one outright.
 */
export async function requestLabResultConsult(
  _prev: RequestLabResultConsultState,
  formData: FormData,
): Promise<RequestLabResultConsultState> {
  const parsed = requestSchema.safeParse({
    labOrderId: String(formData.get("lab_order_id") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { error: "Invalid request" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "Your account has no organisation on file." };
  }

  const { data: request, error: insertError } = await supabase
    .from("lab_result_consult_requests")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      lab_order_id: parsed.data.labOrderId ?? null,
    })
    .select("id, amount_minor, currency")
    .single();
  if (insertError || !request) {
    return { error: insertError?.message ?? "Could not create the request." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "lab_result_consult",
    orderId: request.id,
    organisationId: profile.organisation_id,
    patientId: user.id,
    amountKobo: request.amount_minor,
    currency: request.currency as Currency,
    email: user.email,
    description: "Tarragon Health: self-arranged lab-result consultation fee",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}

/** Patient withdraws a request that hasn't been paid yet (RLS-enforced). */
export async function cancelLabResultConsultRequest(requestId: string): Promise<void> {
  const parsed = z.string().uuid().safeParse(requestId);
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("lab_result_consult_requests")
    .delete()
    .eq("id", parsed.data)
    .in("status", ["requested", "pending_payment"]);
}
