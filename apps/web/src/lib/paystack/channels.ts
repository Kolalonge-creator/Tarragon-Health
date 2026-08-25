/**
 * The three payment methods offered at checkout, restricted to Paystack
 * channel values that need no reusable/tokenised authorization — safe for a
 * one-off charge (booking, voucher instalment, sponsor payment). Paystack's
 * own recurring `plan`-based subscriptions (initializeTransaction, used for
 * the base plan/add-on checkout) are deliberately not offered a channel
 * choice here: Paystack only returns a reusable authorization for a card
 * charge, so a subscription's first payment must stay card-only or every
 * later auto-renewal attempt silently has nothing to charge.
 */
export type PaymentMethod = "card" | "bank_transfer" | "ussd";

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "ussd", label: "USSD" },
];

const PAYMENT_METHODS = new Set<PaymentMethod>(PAYMENT_METHOD_OPTIONS.map((option) => option.value));

/** Narrows an untrusted FormData value, defaulting to "card" for anything unset or unrecognised. */
export function parsePaymentMethod(value: FormDataEntryValue | null): PaymentMethod {
  return typeof value === "string" && PAYMENT_METHODS.has(value as PaymentMethod)
    ? (value as PaymentMethod)
    : "card";
}

/** Paystack's `channels` array restricts its hosted page to exactly the method the patient picked. */
export function paymentMethodToChannels(method: PaymentMethod): string[] {
  return [method];
}
