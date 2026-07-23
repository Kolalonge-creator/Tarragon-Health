/**
 * Shared between apps/web/src/lib/paystack/transactions.ts and
 * apps/web/src/lib/stripe/checkout.ts, and parsed identically by both
 * paystack-webhook and stripe-webhook — whichever provider's checkout ran,
 * this is the only way either webhook knows what a payment activates.
 */
/** 'wallet_topup' is deliberately NOT branched on by the deployed webhooks —
 * they record the verified charge in payment_transactions, and the DB trigger
 * private.credit_wallet_from_payment_transaction (migration 20260723193547)
 * does the crediting. See lib/billing/wallet-checkout.ts. */
export type CheckoutKind = "subscription" | "add_on" | "booking" | "wallet_topup";

export type BookingOrderType = "lab" | "pharmacy" | "referral";

export interface CheckoutMetadata {
  kind: CheckoutKind;
  profile_id: string;
  /** subscription_plans.code (kind='subscription') or add_ons.code (kind='add_on'). Unused for kind='booking'. */
  item_code: string;
  /** Only set for kind='add_on' — the base subscriptions.id it attaches to. */
  subscription_id?: string;
  /** Only set for kind='booking' — the lab_orders/pharmacy_orders/specialist_referrals id being paid for. */
  booking_order_id?: string;
  /** Only set for kind='booking' — which table booking_order_id belongs to. */
  booking_order_type?: BookingOrderType;
  /** Only set for kind='wallet_topup' — the health_wallets.id being funded. */
  wallet_id?: string;
}
