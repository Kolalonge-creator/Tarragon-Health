/**
 * Shared between apps/web/src/lib/paystack/transactions.ts and
 * apps/web/src/lib/stripe/checkout.ts, and parsed identically by both
 * paystack-webhook and stripe-webhook — whichever provider's checkout ran,
 * this is the only way either webhook knows what a payment activates.
 */
export type CheckoutKind = "subscription" | "add_on" | "booking";

export type BookingOrderType = "lab" | "pharmacy" | "referral" | "video_visit";

export interface CheckoutMetadata {
  kind: CheckoutKind;
  profile_id: string;
  /** subscription_plans.code (kind='subscription') or add_ons.code (kind='add_on'). Unused for kind='booking'. */
  item_code: string;
  /** Only set for kind='add_on' — the base subscriptions.id it attaches to. */
  subscription_id?: string;
  /** Only set for kind='booking' — the lab_orders/pharmacy_orders/specialist_referrals/video_visit_requests id being paid for. */
  booking_order_id?: string;
  /** Only set for kind='booking' — which table booking_order_id belongs to. */
  booking_order_type?: BookingOrderType;
}
