/**
 * Shown next to every "buy a credit" / "pay to confirm" button that starts a
 * service_purchases checkout. Paystack (this account's fee-bearer setting)
 * passes its own transaction fee on to the customer, so the amount Paystack
 * actually charges — shown on ITS checkout page, which the patient sees and
 * confirms before paying — comes out higher than the price shown here. That
 * page already prevents any surprise charge; what it doesn't explain is why
 * the number is different from ours, which is what this line is for.
 *
 * Deliberately doesn't predict the exact fee: Paystack only reveals it once
 * a charge completes (it depends on which channel — card, bank transfer,
 * USSD — the patient picks on its page), so there's nothing accurate to
 * quote here. The real number appears afterwards on the receipt (see
 * receipts-list.tsx), built from the actual charge.success event.
 */
export function PaystackFeeNotice() {
  return (
    <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
      Card payments include a small processing fee from our payment provider —
      you&apos;ll see the exact total on the next screen before paying.
    </p>
  );
}
