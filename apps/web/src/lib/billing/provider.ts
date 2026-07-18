import type { Currency } from "@tarragon/shared";

/** NGN bills through Paystack; GBP/USD (diaspora) bill through Stripe. */
export function resolveProvider(currency: Currency): "paystack" | "stripe" {
  return currency === "NGN" ? "paystack" : "stripe";
}
