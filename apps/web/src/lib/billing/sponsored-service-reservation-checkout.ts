import { createClient } from "@/lib/supabase/server";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import { toPatientFacingCheckoutError } from "@/lib/paystack/patient-facing-error";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type SponsoredServiceReservationCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * A launch-scope audit's claim-based diaspora flow: pay for a named service
 * against a bare recipient phone number + first name, no profile created up
 * front and no health details from the sponsor at all — for the "pay for my
 * mum's health check, she'll use the app herself" case, which the existing
 * sponsored-subscription/Care-Voucher paths structurally can't serve (both
 * require a profile_access grant to already exist, per
 * private.can_purchase_voucher_for's own header comment).
 *
 * Two-step, same shape as every other sponsored-payment kind on this
 * platform: this only creates the pending_payment reservation row and starts
 * checkout; the real activation (status -> invited, invite_token minted)
 * happens in private.activate_sponsored_service_reservation when the money
 * actually lands (see that migration's header for why: a grant revoked or a
 * card declined mid-checkout must buy nothing).
 */
export async function initiateSponsoredServiceReservationCheckout(args: {
  serviceProductId: string;
  recipientPhone: string;
  recipientFirstName: string;
  email: string;
  callbackUrl: string;
}): Promise<SponsoredServiceReservationCheckoutResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  if (!isPaystackConfigured()) return { ok: false, error: "Card payments aren't set up yet" };

  const { data: reservationId, error: rpcError } = await supabase.rpc(
    "create_sponsored_service_reservation",
    {
      p_service_product_id: args.serviceProductId,
      p_recipient_phone: args.recipientPhone,
      p_recipient_first_name: args.recipientFirstName,
    }
  );
  if (rpcError || !reservationId) {
    return { ok: false, error: rpcError?.message ?? "Could not start this reservation" };
  }

  const { data: product } = await supabase
    .from("service_products")
    .select("price_kobo, currency")
    .eq("id", args.serviceProductId)
    .maybeSingle();
  if (!product || product.currency !== "NGN") {
    return { ok: false, error: "That service can't be paid in your currency yet." };
  }

  const metadata: CheckoutMetadata = {
    kind: "sponsored_service_reservation",
    profile_id: user.id,
    item_code: args.serviceProductId,
    reservation_id: reservationId as string,
  };

  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: product.price_kobo,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: toPatientFacingCheckoutError(result.error) };
  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
