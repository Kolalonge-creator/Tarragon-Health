/**
 * Shared between apps/web/src/lib/paystack/transactions.ts and
 * apps/web/src/lib/stripe/checkout.ts, and parsed identically by both
 * paystack-webhook and stripe-webhook — whichever provider's checkout ran,
 * this is the only way either webhook knows what a payment activates.
 */
/**
 * 'wallet_topup' is read only by private.credit_wallet_from_payment_transaction
 * (an AFTER INSERT trigger on payment_transactions, see
 * supabase/migrations/20260723193547_health_wallet_core.sql) — NOT by the
 * deployed paystack-webhook/stripe-webhook Edge Functions, which don't
 * recognise it and cosmetically no-op on it (their unknown-kind branch just
 * marks the payment_transactions row with an error string; the row is
 * already inserted by then, which is all the trigger needs). Deliberate: it
 * lets wallet top-ups ship without redeploying either webhook.
 */
export type CheckoutKind = "subscription" | "add_on" | "booking" | "wallet_topup";

export type BookingOrderType = "lab" | "pharmacy" | "referral";

export interface CheckoutMetadata {
  kind: CheckoutKind;
  profile_id: string;
  /** subscription_plans.code (kind='subscription') or add_ons.code (kind='add_on'). Unused for kind='booking'/'wallet_topup'. */
  item_code: string;
  /** Only set for kind='add_on' — the base subscriptions.id it attaches to. */
  subscription_id?: string;
  /** Only set for kind='booking' — the lab_orders/pharmacy_orders/specialist_referrals id being paid for. */
  booking_order_id?: string;
  /** Only set for kind='booking' — which table booking_order_id belongs to. */
  booking_order_type?: BookingOrderType;
}
