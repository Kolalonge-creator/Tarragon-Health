"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";
import type { Currency } from "@tarragon/shared";

export type RequestResultsInterpretationState = { error: string } | undefined;

/**
 * E3 Results Interpretation (Revenue Architecture and Earnings Plan, 27 Aug
 * 2026) — a one-off, any-plan-including-Free purchase. Mirrors
 * requestVideoVisit (video-visit-actions.ts): create the request row (its
 * price is server-derived from results_interpretation_prices by
 * private.pin_results_interpretation_amount, never client-sent), then hand
 * off to the same generic booking-checkout machinery lab/pharmacy/referral/
 * video-visit already use. No slot to pick — this is the whole form.
 */
export async function requestResultsInterpretation(
  _prev: RequestResultsInterpretationState,
  _formData: FormData,
): Promise<RequestResultsInterpretationState> {
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
    .from("results_interpretation_requests")
    .insert({ organisation_id: profile.organisation_id, patient_id: user.id })
    .select("id, amount_minor, currency")
    .single();
  if (insertError || !request) {
    return { error: insertError?.message ?? "Could not create the request." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "results_interpretation",
    orderId: request.id,
    organisationId: profile.organisation_id,
    patientId: user.id,
    amountKobo: request.amount_minor,
    currency: request.currency as Currency,
    email: user.email,
    description: "Tarragon Health: results interpretation",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}
