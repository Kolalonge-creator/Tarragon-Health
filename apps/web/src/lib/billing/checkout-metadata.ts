/**
 * Read by apps/web/src/lib/paystack/transactions.ts at checkout time and by
 * supabase/functions/paystack-webhook/handler.ts on the way back — this is
 * the only way the webhook knows what a payment activates. (Stripe/GBP
 * diaspora billing, including a stripe-webhook Edge Function and an
 * apps/web/src/lib/stripe/ checkout module, were removed from this codebase
 * entirely on 2026-09-02 — Paystack is now the only live payment provider.
 * Older comments in this file describing a second webhook were stale.)
 */
/**
 * 'voucher_payment' activates via
 * private.apply_voucher_payment_from_transaction (an AFTER INSERT trigger on
 * payment_transactions, see
 * supabase/migrations/20260731215226_care_vouchers_purchase_and_layaway.sql,
 * latest definition in 20260901200037_care_voucher_payments_rename_credit_to_instalment.sql).
 * The webhook's own charge.success switch also has an explicit branch for
 * this kind (added 2026-09-23, see handler.ts) that re-verifies the
 * trigger's own target row (care_voucher_payments) rather than trusting it
 * blindly — earlier comments here describing the webhook as not recognising
 * this kind at all were true before that date and are now stale.
 *
 * It replaced 'wallet_topup' when the Health Wallet was retired on
 * 2026-07-31; nothing emits that kind any more.
 */
/**
 * 'sponsored_subscription' activates the same way, via
 * private.activate_sponsored_service_purchase (an AFTER INSERT trigger on
 * payment_transactions; current definition in
 * supabase/migrations/20260905060745_payment_activation_verifies_the_amount_and_the_reference.sql
 * — the function was renamed/rewritten more than once since its original
 * 20260801092000_sponsor_notifications_and_sponsored_plans.sql migration, so
 * check the live definition rather than that first migration alone). It
 * puts someone else on a plan and bills the caller, which is the single
 * most-asked-for diaspora action and had no path at all before.
 *
 * Same webhook-recognition correction as voucher_payment above — see
 * handler.ts's charge.success switch.
 */
/**
 * 'screening_day_payment' activates the same way, via
 * private.apply_screening_day_payment_from_transaction (an AFTER INSERT
 * trigger on payment_transactions, see
 * supabase/migrations/20260829003735_group_screening_days.sql). One payer
 * funds a whole group screening day's discounted slots in a single charge
 * (or a handful of instalments); the trigger credits the screening_days row.
 *
 * Same webhook-recognition correction as voucher_payment above.
 */
/**
 * 'subsidy_contribution' activates the same way, via
 * private.apply_subsidy_contribution_from_transaction (an AFTER INSERT
 * trigger on payment_transactions, see
 * supabase/migrations/20260830113902_subsidy_split_engine.sql). Two of these
 * checkouts exist per subsidised order — one for the sponsor's share, one
 * for the patient's — each carrying its own subsidy_contribution_id. The
 * underlying lab/pharmacy/referral order only flips to payment_confirmed
 * once BOTH contributions have landed.
 *
 * Same webhook-recognition correction as voucher_payment above.
 */
/**
 * 'service_purchase' activates the same way, via
 * private.apply_service_purchase_payment (an AFTER INSERT trigger on
 * payment_transactions, see
 * supabase/migrations/20260831143207_service_purchase_checkout_and_payment_trigger.sql).
 * The webhook's charge.success switch has re-verified this kind's own
 * target row (service_purchases) since this trigger's introduction — the
 * "webhook doesn't recognise this kind" framing that used to describe every
 * kind on this page never actually applied to this one. It replaces
 * 'subscription'/'add_on' as the pay-per-service business model
 * (2026-08-31) retires subscription_plans/subscriptions in favour of
 * service_products/service_purchases — new purchases should use this kind;
 * 'subscription'/'add_on' are kept below only until the old tables and their
 * webhook branches are removed in a later migration.
 */
/**
 * 'platform_credit_topup' (2026-09-17) activates the same way, via
 * private.apply_platform_credit_topup_payment (an AFTER INSERT trigger on
 * payment_transactions, see
 * supabase/migrations/20260917100406_platform_credit_ledger_functions.sql).
 * A patient tops up a non-expiring, never-cashed-out platform credit
 * balance in any amount (suggested ₦10k/20k/50k/100k or custom); spending it
 * against a service_purchases row happens synchronously via
 * public.pay_service_purchase_on_platform_credit and never goes through
 * Paystack/this metadata shape at all — only funding the balance does.
 *
 * Same webhook-recognition correction as voucher_payment above.
 */
export type CheckoutKind =
  | "subscription"
  | "add_on"
  | "booking"
  | "voucher_payment"
  | "sponsored_subscription"
  | "screening_day_payment"
  | "subsidy_contribution"
  | "service_purchase"
  | "platform_credit_topup";

export type BookingOrderType = "lab" | "pharmacy" | "referral" | "video_visit" | "lab_result_consult";

export interface CheckoutMetadata {
  kind: CheckoutKind;
  profile_id: string;
  /** subscription_plans.code (kind='subscription'/'sponsored_subscription') or add_ons.code (kind='add_on'). Unused for kind='booking'/'voucher_payment'/'screening_day_payment'. */
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
  /** Only set for kind='subsidy_contribution' — the subsidy_contributions.id this specific charge settles. */
  subsidy_contribution_id?: string;
}
