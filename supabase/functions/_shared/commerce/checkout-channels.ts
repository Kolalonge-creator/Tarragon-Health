import { isPaymentChannelList, type PaymentChannel } from "../integrations/payment.ts";

/**
 * The payment methods the hosted Paystack page offers (S71, 19.2), now configuration-driven (gap 71).
 *
 * `CONFIGURED_CHECKOUT_CHANNELS` is the edge-function mirror of the PROPOSED config key `checkout.payment_channels`
 * (packages/shared/src/proposed-config/registry.ts). A Deno function cannot import that package, so the value is mirrored here and a Jest
 * test (packages/shared/src/proposed-config/checkout-channels-mirror.test.ts) fails if the two drift.
 *
 * DO NOT add "qr" (Paystack's Zap / QR) or any other channel here until a human has verified the exact channel string against the live
 * Paystack account and docs (OQ-401, OQ-S71-CHANNELS). The `PAYMENT_CHANNELS` allow-list contains "qr" but it is deliberately never sent.
 * Changing this value is a human decision, made by publishing a new versioned registry entry and updating this mirror in the same change.
 */
export const CONFIGURED_CHECKOUT_CHANNELS: unknown = ["card", "bank_transfer", "ussd"];

/** The safe fallback: exactly the channels that shipped in S71. Never empty. */
export const FALLBACK_CHECKOUT_CHANNELS: readonly PaymentChannel[] = ["card", "bank_transfer", "ussd"];

/**
 * Validates a configured channel list against the PAYMENT_CHANNELS allow-list (non-empty, unique, every member allowed).
 * Anything else (unknown channel, empty, not an array, duplicates) falls back to the default: never an empty channel list.
 */
export function resolveCheckoutChannels(configured: unknown): readonly PaymentChannel[] {
  return isPaymentChannelList(configured) ? [...configured] : FALLBACK_CHECKOUT_CHANNELS;
}
