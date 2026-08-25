"use client";

import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "@/lib/paystack/channels";

/**
 * Drop into any checkout form that ends in a Paystack (NGN) charge — renders
 * a `name="paymentMethod"` radio group the receiving server action reads via
 * `parsePaymentMethod(formData.get("paymentMethod"))`. Not for Stripe
 * (diaspora GBP/USD) checkout, which has no channel choice.
 */
export function PaymentMethodPicker({
  defaultValue = "card",
  className,
}: {
  defaultValue?: PaymentMethod;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-1", className)}>
      <legend className="text-xs font-medium text-charcoal-ink/70">Pay with</legend>
      <div className="flex gap-2">
        {PAYMENT_METHOD_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex-1 cursor-pointer rounded-md border border-charcoal-ink/20 px-3 py-1.5 text-center text-sm text-charcoal-ink transition-colors has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/10 has-[:checked]:text-brand-green has-[:checked]:font-medium"
          >
            <input
              type="radio"
              name="paymentMethod"
              value={option.value}
              defaultChecked={option.value === defaultValue}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
