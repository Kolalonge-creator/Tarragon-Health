import type { PaymentProvider } from "../integrations/payment.ts";
import type { OrderStore } from "./orders.ts";

/**
 * Starting a checkout (S25). The order is created in the database AS THE SIGNED-IN PATIENT (so the database decides who may
 * buy what, the price, the gate and the capacity), then a Paystack transaction is initialised for exactly that order's price.
 * The client never sends an amount. Paystack metadata is the order id only (INV-07: Paystack shows metadata in its dashboard).
 */
export const ORDER_ERROR_CODES = [
  "checkout_not_open", "item_not_available", "already_member", "no_capacity", "too_many_open_orders",
  "order_beneficiary_not_allowed", "order_not_authorised",
] as const;
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
}
export interface OrderCreator {
  create(code: string, clientKey: string, beneficiary?: string): Promise<{ readonly ok: true; readonly order: CreatedOrder } | { readonly ok: false; readonly code: OrderErrorCode | "unknown" }>;
}

export type StartCheckoutResult =
  | { readonly ok: true; readonly orderId: string; readonly reference: string; readonly amountKobo: number; readonly checkoutUrl: string }
  | { readonly ok: false; readonly code: OrderErrorCode | "unknown" | "email_needed" | "already_paid" | "order_closed" | "payment_unavailable" | "checkout_link_lost" };

export async function startCheckout(
  deps: { readonly payments: PaymentProvider; readonly store: OrderStore; readonly orders: OrderCreator },
  args: { readonly code: string; readonly clientKey: string; readonly email: string | null; readonly callbackUrl: string; readonly beneficiary?: string },
): Promise<StartCheckoutResult> {
  if (!args.email) return { ok: false, code: "email_needed" };
  const created = await deps.orders.create(args.code, args.clientKey, args.beneficiary);
  if (!created.ok) return { ok: false, code: created.code };
  const o = created.order;
  if (o.state === "paid") return { ok: false, code: "already_paid" };
  if (o.state !== "created") return { ok: false, code: "order_closed" };
  // A retry of the same tap: the hosted page already exists, open it again (Paystack refuses a reused reference).
  if (o.checkoutUrl) return { ok: true, orderId: o.orderId, reference: o.reference, amountKobo: o.amountKobo, checkoutUrl: o.checkoutUrl };

  const init = await deps.payments.initializeTransaction({
    reference: o.reference,
    email: args.email,
    amountKobo: o.amountKobo,
    callbackUrl: args.callbackUrl,
    metadata: { kind: "order", order_id: o.orderId },
  });
  if (!init.ok) return { ok: false, code: init.error.code === "conflict" ? "checkout_link_lost" : "payment_unavailable" };
  // Best effort: if keeping the link fails the patient still pays; only a retry of this exact tap loses the link.
  await deps.store.setCheckoutUrl(o.reference, init.data.authorizationUrl);
  return { ok: true, orderId: o.orderId, reference: o.reference, amountKobo: o.amountKobo, checkoutUrl: init.data.authorizationUrl };
}
