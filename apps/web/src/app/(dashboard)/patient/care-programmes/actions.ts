"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initiateProgrammePurchaseCheckout } from "@/lib/billing/programme-purchase-checkout";

export type PurchaseCareProgrammeState = { error?: string } | undefined;

/**
 * Buys a Care Programme (e.g. the 12-Week Hypertension Programme) — a flat,
 * one-time fee for a bounded window, replacing the old subscription model.
 * Mirrors createAndPayForPartnerLabOrder's shape exactly: insert on the
 * caller's own RLS'd client (patient_id = auth.uid() is all the insert policy
 * allows), then straight to hosted checkout in one step. All real pricing and
 * availability checks are server-side, in
 * private.set_programme_purchase_computed_price (a BEFORE INSERT trigger no
 * client input reaches) — this action does not trust or compute a price.
 */
export async function purchaseCareProgramme(
  _prevState: PurchaseCareProgrammeState,
  formData: FormData,
): Promise<PurchaseCareProgrammeState> {
  const programmeId = formData.get("programmeId");
  if (typeof programmeId !== "string" || !programmeId) {
    return { error: "Pick a programme first" };
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

  const { data: purchase, error: insertError } = await supabase
    .from("programme_purchases")
    .insert({
      patient_id: user.id,
      programme_id: programmeId,
      organisation_id: profile.organisation_id,
    })
    .select("id, price_kobo, programme:chronic_condition_programmes!programme_purchases_programme_id_fkey(name)")
    .single();
  if (insertError || !purchase) {
    return { error: insertError?.message ?? "We couldn't set that programme up just now. Please try again." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateProgrammePurchaseCheckout({
    purchaseId: purchase.id,
    organisationId: profile.organisation_id,
    patientId: user.id,
    amountKobo: purchase.price_kobo,
    email: user.email,
    description: purchase.programme?.name ?? "Care Programme",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}
