/**
 * Shared between apps/web/src/lib/paystack/transactions.ts and
 * apps/web/src/lib/stripe/checkout.ts, and parsed identically by both
 * paystack-webhook and stripe-webhook — whichever provider's checkout ran,
 * this is the only way either webhook knows what a payment activates.
 */
/**
 * 'voucher_payment' is read only by
 * private.apply_voucher_payment_from_transaction (an AFTER INSERT trigger on
 * payment_transactions, see
 * supabase/migrations/20260731215226_care_vouchers_purchase_and_layaway.sql)
 * — NOT by the deployed paystack-webhook/stripe-webhook Edge Functions, which
 * don't recognise it and cosmetically no-op on it (their unknown-kind branch
 * just marks the payment_transactions row with an error string; the row is
 * already inserted by then, which is all the trigger needs). Deliberate: it
 * lets voucher instalments ship without redeploying either webhook.
 *
 * It replaced 'wallet_topup' when the Health Wallet was retired on
 * 2026-07-31; nothing emits that kind any more.
 */
/**
 * 'sponsored_subscription' is read the same way, by
 * private.activate_sponsored_subscription (an AFTER INSERT trigger on
 * payment_transactions, see
 * supabase/migrations/20260801092000_sponsor_notifications_and_sponsored_plans.sql).
 * It puts someone else on a plan and bills the caller, which is the single
 * most-asked-for diaspora action and had no path at all before.
 *
 * Same deliberate reason as voucher_payment: the deployed webhooks do not
 * recognise it and cosmetically no-op, so this ships without redeploying
 * either Edge Function — a redeploy this codebase has been bitten by twice.
 */
export type CheckoutKind =
  | "subscription"
  | "add_on"
  | "booking"
  | "voucher_payment"
  | "sponsored_subscription";

export type BookingOrderType = "lab" | "pharmacy" | "referral" | "video_visit";

export interface CheckoutMetadata {
  kind: CheckoutKind;
  profile_id: string;
  /** subscription_plans.code (kind='subscription'/'sponsored_subscription') or add_ons.code (kind='add_on'). Unused for kind='booking'/'voucher_payment'. */
  item_code: string;
  /** Only set for kind='add_on' — the base subscriptions.id it attaches to. */
  subscription_id?: string;
  /** Only set for kind='booking' — the lab_orders/pharmacy_orders/specialist_referrals/video_visit_requests id being paid for. */
  booking_order_id?: string;
  /** Only set for kind='booking' — which table booking_order_id belongs to. */
  booking_order_type?: BookingOrderType;
  /** Only set for kind='sponsored_subscription' — whose plan is being paid for. */
  beneficiary_profile_id?: string;
  /** Only set for kind='sponsored_subscription' — who is being billed. Read by the DB trigger, which re-checks the grant still exists when the money lands. */
  sponsor_profile_id?: string;
  /** Only set for kind='sponsored_subscription' — subscription_plans.code, read by the trigger. */
  plan_code?: string;
}
