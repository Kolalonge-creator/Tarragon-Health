import { createClient } from "@/lib/supabase/server";
import { initiateProgrammePurchaseCheckout } from "@/lib/billing/programme-purchase-checkout";

export type SponsoredProgrammePurchaseResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * A sponsor buying a Care Programme for someone they support — the
 * replacement for the retired paySomeonesPlan/initiateSponsoredSubscription
 * Checkout (which put a beneficiary on a paid subscription; see
 * 20260830020316_programme_purchases_allow_sponsor_insert.sql for why that
 * needed a schema change, not just new app code).
 *
 * Unlike the subscription version (which created nothing until the webhook
 * fired), this inserts the programme_purchases row up front, on the CALLER's
 * (sponsor's) own RLS'd client, with patient_id set to the BENEFICIARY — now
 * permitted by private.can_purchase_voucher_for(), the same relationship
 * check Care Voucher gifting already uses. Real pricing/availability is still
 * entirely server-derived by the BEFORE INSERT trigger; this function trusts
 * nothing from its caller except which programme and whose care it is for.
 *
 * The grant is re-checked a second time too, at the moment payment actually
 * confirms — private.activate_programme_purchase_from_transaction compares
 * programme_purchases.purchased_by (who inserted the row) against patient_id
 * (the beneficiary) and re-runs can_purchase_voucher_for before activating,
 * same reasoning as activate_sponsored_subscription's own "the sponsor must
 * still hold a grant when the money lands" check
 * (20260830082927_programme_purchases_sponsor_grant_recheck.sql). A grant
 * revoked between checkout and the webhook now cancels the purchase instead
 * of silently activating it.
 */
export async function initiateSponsoredProgrammePurchaseCheckout(args: {
  beneficiaryProfileId: string;
  programmeId: string;
  email: string;
  callbackUrl: string;
}): Promise<SponsoredProgrammePurchaseResult> {
  const supabase = await createClient();

  const { data: beneficiary } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", args.beneficiaryProfileId)
    .single();
  if (!beneficiary?.organisation_id) {
    return { ok: false, error: "That person has no organisation on file." };
  }

  const { data: purchase, error: insertError } = await supabase
    .from("programme_purchases")
    .insert({
      patient_id: args.beneficiaryProfileId,
      programme_id: args.programmeId,
      organisation_id: beneficiary.organisation_id,
    })
    .select(
      "id, price_kobo, organisation_id, programme:chronic_condition_programmes!programme_purchases_programme_id_fkey(name)",
    )
    .single();
  if (insertError || !purchase) {
    return {
      ok: false,
      error:
        insertError?.code === "42501"
          ? "You can only buy care for yourself or someone who has linked you to their care."
          : (insertError?.message ?? "We couldn't set that programme up just now. Please try again."),
    };
  }

  const result = await initiateProgrammePurchaseCheckout({
    purchaseId: purchase.id,
    organisationId: purchase.organisation_id,
    patientId: args.beneficiaryProfileId,
    amountKobo: purchase.price_kobo,
    email: args.email,
    description: purchase.programme?.name ?? "Care Programme",
    callbackUrl: args.callbackUrl,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, checkoutUrl: result.checkoutUrl };
}
