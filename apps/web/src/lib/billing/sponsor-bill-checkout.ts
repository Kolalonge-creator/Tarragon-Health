import { createClient } from "@/lib/supabase/server";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";
import type { BookingOrderType } from "@/lib/billing/checkout-metadata";

export type SponsorBillCheckoutResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string };

/**
 * Pays one specific bill belonging to somebody you support, on your own card.
 *
 * Until now the only way a supporter could settle anything was to redeem a
 * Care Voucher the person already held — the button read "No voucher for
 * this" against a real, itemised, unpaid bill. So a son looking at his
 * mother's ₦4,500 refill could see exactly what it cost and had no way to pay
 * it, unless he had happened to buy a voucher for that same named service
 * first. (The direct path that used to exist, sponsor_pay_booking_order, was
 * dropped with the Health Wallet on 2026-07-31 and never replaced.)
 *
 * Two things make this safe:
 *
 *  - **The amount is never taken from the caller.** It is read back from
 *    sponsor_payable_orders, which is SECURITY DEFINER and returns the
 *    authoritative figure off the order row. A tampered client cannot change
 *    what a bill costs.
 *  - **That same call is the authorisation.** sponsor_payable_orders raises
 *    42501 without a 'manage' grant, so listing and paying cannot drift apart:
 *    if a bill is not in the list, it cannot be paid, and if the grant is gone
 *    the list is empty.
 *
 * The receipt goes to the payer's own email, because they are the one being
 * charged. What the money paid for is described by category only, exactly as
 * everywhere else on this surface.
 */
export async function initiateSponsorBillCheckout(args: {
  beneficiaryProfileId: string;
  orderId: string;
  email: string;
  callbackUrl: string;
}): Promise<SponsorBillCheckoutResult> {
  const supabase = await createClient();

  // Authorisation and price in one call — deliberately not two, so they cannot
  // disagree.
  const { data, error } = await supabase.rpc("sponsor_payable_orders", {
    p_beneficiary: args.beneficiaryProfileId,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "You don't have permission to pay this person's bills."
          : error.message,
    };
  }

  const bills = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const bill = bills.find((row) => row.order_id === args.orderId);
  if (!bill) {
    // Already paid, cancelled, or never theirs. All three are the same answer
    // to the person pressing the button.
    return { ok: false, error: "That bill is no longer waiting to be paid." };
  }

  const amountKobo = Number(bill.amount_kobo);
  const orderType = bill.order_type as BookingOrderType;
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    return { ok: false, error: "That bill has no amount to pay yet." };
  }

  const { data: beneficiary } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", args.beneficiaryProfileId)
    .maybeSingle();
  if (!beneficiary?.organisation_id) {
    return { ok: false, error: "We couldn't work out where to send this payment." };
  }

  // The bill is priced in naira because the care happens in Nigeria. NGN via
  // Paystack only — a payer-currency conversion path for a sponsor abroad
  // used to sit here, converting at the admin-set reference rate and billing
  // through Stripe. Removed 2026-09-03: there was never a registered Stripe
  // account behind it, so a non-NGN payment could never actually complete. A
  // sponsor abroad pays the same naira price everyone else pays, via
  // Paystack, same as anyone else.
  return initiateBookingCheckout({
    orderType,
    orderId: args.orderId,
    organisationId: beneficiary.organisation_id,
    // The order stays the beneficiary's; only the card is the supporter's.
    patientId: args.beneficiaryProfileId,
    amountKobo,
    currency: "NGN",
    email: args.email,
    description: String(bill.label ?? "Care for someone you support"),
    callbackUrl: args.callbackUrl,
  });
}
