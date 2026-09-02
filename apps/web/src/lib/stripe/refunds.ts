import { stripeCall, type StripeResult } from "./client";

/**
 * Refund a Stripe-collected charge, given the reference recorded at checkout
 * time. `care_voucher_payments.pending_provider_ref` (and
 * apply_voucher_payment_from_transaction's own matching logic) stores a
 * hosted Checkout Session id (cs_...) for Stripe payments — a Checkout
 * Session is never directly refundable, Stripe requires the underlying
 * PaymentIntent, so a cs_ reference is resolved to one first. A reference
 * that's already a PaymentIntent id is refunded directly.
 *
 * Mirrors apps/web/src/lib/paystack/refunds.ts's refundTransaction() shape —
 * omitting `amountMinor` refunds the full charge.
 */
export async function refundStripeCharge(args: {
  reference: string;
  amountMinor?: number;
}): Promise<StripeResult<{ refundId: string; status: string }>> {
  return stripeCall(async (stripe) => {
    let paymentIntentId = args.reference;

    if (args.reference.startsWith("cs_")) {
      const session = await stripe.checkout.sessions.retrieve(args.reference);
      const pi = session.payment_intent;
      if (!pi) throw new Error("Checkout session has no payment_intent to refund");
      paymentIntentId = typeof pi === "string" ? pi : pi.id;
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(args.amountMinor !== undefined ? { amount: args.amountMinor } : {}),
    });
    return { refundId: refund.id, status: refund.status ?? "unknown" };
  });
}
