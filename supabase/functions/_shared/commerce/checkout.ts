import type { PaymentChannel, PaymentProvider } from "../integrations/payment.ts";
import type { OrderStore } from "./orders.ts";

/**
 * Starting a checkout (S25). The order is created in the database AS THE SIGNED-IN PATIENT (so the database decides who may
 * buy what, the price, the gate and the capacity), then a Paystack transaction is initialised for exactly that order's price.
 * The client never sends an amount. Paystack metadata is the order id only (INV-07: Paystack shows metadata in its dashboard).
 */
export const ORDER_ERROR_CODES = [
  "checkout_not_open", "item_not_available", "already_member", "no_capacity", "too_many_open_orders",
  "order_beneficiary_not_allowed", "gift_item_not_allowed", "order_not_authorised",
  // S73: the pricing engine
  "membership_not_open", "quote_changed", "sponsor_billing_not_open", "order_fully_covered", "discount_code_invalid", "discount_code_rate_limited",
  // S71: sponsor-paid items and HMO eligibility
  "sponsor_budget_exhausted", "sponsor_payment_not_open",
] as const;

/**
 * The payment methods the hosted page offers (S71, 19.2): card, bank transfer ("Pay with Transfer") and USSD, sent explicitly so the page never
 * follows the Paystack dashboard defaults. Bank transfer and USSD settle late: a person is told "waiting for your bank", never "failed".
 * The exact strings Paystack accepts were taken from its published API reference and are still to be proved with the founder's test key (OQ-401).
 */
export const DEFAULT_CHECKOUT_CHANNELS: readonly PaymentChannel[] = ["card", "bank_transfer", "ussd"];
export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

export function mapOrderError(message: string): OrderErrorCode | "unknown" {
  for (const c of ORDER_ERROR_CODES) if (message.includes(c)) return c;
  return "unknown";
}

export interface CreatedOrder {
  readonly orderId: string;
  readonly reference: string;
  readonly amountKobo: number;
  readonly state: string;
  readonly checkoutUrl: string | null;
  /** S71: true when a sponsor pays the whole order. There is then nothing to pay, no payment step, and the order is already paid. */
  readonly covered?: boolean;
  readonly sponsorName?: string | null;
}
/** What a buyer can add to an order (S73). The amount is never one of them: `expectedAmountKobo` is the total the person was SHOWN, and a mismatch refuses the order. */
export interface OrderExtras {
  readonly discountCode?: string;
  readonly usePoints?: boolean;
  readonly expectedAmountKobo?: number;
}
export interface OrderCreator {
  create(code: string, clientKey: string, beneficiary?: string, extras?: OrderExtras): Promise<{ readonly ok: true; readonly order: CreatedOrder } | { readonly ok: false; readonly code: OrderErrorCode | "unknown" }>;
}

export type StartCheckoutResult =
  | { readonly ok: true; readonly covered: true; readonly orderId: string; readonly reference: string; readonly sponsorName: string | null; readonly amountKobo?: undefined; readonly checkoutUrl?: undefined }
  | { readonly ok: true; readonly covered?: false; readonly orderId: string; readonly reference: string; readonly amountKobo: number; readonly checkoutUrl: string }
  | { readonly ok: false; readonly code: OrderErrorCode | "unknown" | "email_needed" | "already_paid" | "order_closed" | "payment_unavailable" | "checkout_link_lost" };

export async function startCheckout(
  deps: { readonly payments: PaymentProvider; readonly store: OrderStore; readonly orders: OrderCreator },
  args: { readonly code: string; readonly clientKey: string; readonly email: string | null; readonly callbackUrl: string; readonly beneficiary?: string; readonly channels?: readonly PaymentChannel[] } & OrderExtras,
): Promise<StartCheckoutResult> {
  // A fully covered order needs no email and no card: the sponsor pays, so the person never reaches a payment step (S71, 19.5).
  const preEmail = args.email;
  const extras: OrderExtras = {
    ...(args.discountCode ? { discountCode: args.discountCode } : {}),
    ...(args.usePoints ? { usePoints: true } : {}),
    ...(args.expectedAmountKobo !== undefined ? { expectedAmountKobo: args.expectedAmountKobo } : {}),
  };
  const created = await deps.orders.create(args.code, args.clientKey, args.beneficiary, extras);
  if (!created.ok) return { ok: false, code: created.code };
  const o = created.order;
  if (o.covered && o.state === "paid") return { ok: true, covered: true, orderId: o.orderId, reference: o.reference, sponsorName: o.sponsorName ?? null };
  if (!preEmail) return { ok: false, code: "email_needed" };
  if (o.state === "paid") return { ok: false, code: "already_paid" };
  if (o.state !== "created") return { ok: false, code: "order_closed" };
  // A retry of the same tap: the hosted page already exists, open it again (Paystack refuses a reused reference).
  if (o.checkoutUrl) return { ok: true, orderId: o.orderId, reference: o.reference, amountKobo: o.amountKobo, checkoutUrl: o.checkoutUrl };

  const init = await deps.payments.initializeTransaction({
    reference: o.reference,
    email: preEmail,
    amountKobo: o.amountKobo,
    callbackUrl: args.callbackUrl,
    channels: args.channels ?? DEFAULT_CHECKOUT_CHANNELS,
    metadata: { kind: "order", order_id: o.orderId },
  });
  if (!init.ok) return { ok: false, code: init.error.code === "conflict" ? "checkout_link_lost" : "payment_unavailable" };
  // Best effort: if keeping the link fails the patient still pays; only a retry of this exact tap loses the link.
  await deps.store.setCheckoutUrl(o.reference, init.data.authorizationUrl);
  return { ok: true, orderId: o.orderId, reference: o.reference, amountKobo: o.amountKobo, checkoutUrl: init.data.authorizationUrl };
}
