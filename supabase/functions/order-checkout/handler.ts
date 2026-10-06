// S25: POST /functions/v1/order-checkout. The signed-in patient asks to buy one catalogue item.
//
// The order is created in the database AS THE PATIENT (create_order decides who may buy what, the price, the dormant gate and the
// capacity), then a Paystack transaction is initialised for exactly that order's price. The client sends an item code and a
// retry key and nothing else: never an amount, never a return URL (the return URL comes from configuration, so a hostile client
// cannot send a patient to another site after payment). The reply carries ids and the hosted checkout link only.
import { mapOrderError, startCheckout, type CreatedOrder, type OrderCreator, type OrderStore } from "../_shared/commerce/index.ts";
import type { PaymentProvider } from "../_shared/integrations/index.ts";

export interface CheckoutDeps {
  readonly payments: PaymentProvider | null;
  readonly store: OrderStore;
  /** Reads the caller's identity and email from their own JWT. */
  readonly whoami: (authorization: string) => Promise<{ readonly id: string; readonly email: string | null } | null>;
  /** create_order run with the caller's JWT. */
  readonly rpcAsUser: (authorization: string, fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  readonly returnUrl: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_]{2,63}$/;

const STATUS: Record<string, number> = {
  email_needed: 422, checkout_not_open: 409, item_not_available: 409, already_member: 409, no_capacity: 409, too_many_open_orders: 429,
  order_beneficiary_not_allowed: 403, order_not_authorised: 403, already_paid: 409, order_closed: 409, payment_unavailable: 502, checkout_link_lost: 409, unknown: 500,
};

export async function handleCheckout(req: Request, deps: CheckoutDeps): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });
  const me = await deps.whoami(auth);
  if (!me) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!deps.payments || !deps.returnUrl) return Response.json({ error: "payment_unavailable" }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b["code"] !== "string" || !CODE.test(b["code"]) || typeof b["client_key"] !== "string" || !UUID.test(b["client_key"])) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const orders: OrderCreator = {
    async create(code, clientKey) {
      const { data, error } = await deps.rpcAsUser(auth, "create_order", { p_code: code, p_client_key: clientKey });
      if (error) return { ok: false, code: mapOrderError(error.message) };
      const d = data as Record<string, unknown> | null;
      if (!d || typeof d["order_id"] !== "string" || typeof d["reference"] !== "string" || typeof d["amount_kobo"] !== "number") return { ok: false, code: "unknown" };
      const order: CreatedOrder = {
        orderId: d["order_id"], reference: d["reference"], amountKobo: d["amount_kobo"],
        state: typeof d["state"] === "string" ? d["state"] : "created",
        checkoutUrl: typeof d["checkout_url"] === "string" ? d["checkout_url"] : null,
      };
      return { ok: true, order };
    },
  };

  const r = await startCheckout({ payments: deps.payments, store: deps.store, orders }, { code: b["code"], clientKey: b["client_key"], email: me.email, callbackUrl: deps.returnUrl });
  if (!r.ok) return Response.json({ error: r.code }, { status: STATUS[r.code] ?? 500 });
  return Response.json({ order_id: r.orderId, reference: r.reference, amount_kobo: r.amountKobo, checkout_url: r.checkoutUrl });
}
