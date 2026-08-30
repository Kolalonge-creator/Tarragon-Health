import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { initializeOneOffTransaction } from "@/lib/paystack/transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

export type ProgrammePurchaseCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Starts payment for a programme_purchases row (12-Week Hypertension
 * Programme and similar) — NGN/Paystack only, same scope as
 * createAndPayForPartnerLabOrder's implicit assumption. A diaspora buyer
 * paying in another currency goes through the Care Voucher path instead
 * (apps/web/src/lib/billing/voucher-checkout.ts already supports non-NGN
 * top-ups), not this function.
 *
 * Deliberately does not use initiateBookingCheckout/bookingTableFor — those
 * are wired to kind='booking', whose booking_order_type is resolved against a
 * table map hardcoded inside the separately-deployed paystack-webhook Edge
 * Function. This uses kind='programme_purchase' instead, activated by a
 * payment_transactions trigger that needs no webhook redeploy — see
 * checkout-metadata.ts's header comment on that CheckoutKind.
 */
export async function initiateProgrammePurchaseCheckout(args: {
  purchaseId: string;
  organisationId: string;
  patientId: string;
  amountKobo: number;
  email: string;
  description: string;
  callbackUrl: string;
}): Promise<ProgrammePurchaseCheckoutResult> {
  if (!isPaystackConfigured()) {
    return { ok: false, error: "Card payments aren't set up yet" };
  }

  const metadata: CheckoutMetadata = {
    kind: "programme_purchase",
    profile_id: args.patientId,
    item_code: "programme_purchase",
    programme_purchase_id: args.purchaseId,
  };

  const result = await initializeOneOffTransaction({
    email: args.email,
    amountMinor: args.amountKobo,
    currency: "NGN",
    callbackUrl: args.callbackUrl,
    metadata,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const serviceRole = createServiceRoleClient();
  const { error } = await serviceRole
    .from("programme_purchases")
    .update({ pending_payment_provider_ref: result.data.reference })
    .eq("id", args.purchaseId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, checkoutUrl: result.data.authorizationUrl };
}
