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
/** A discount code as a person types it: letters and digits, spaces or dashes between groups. The database normalises it. */
const DISCOUNT = /^[A-Za-z0-9][A-Za-z0-9 -]{2,31}$/;

const STATUS: Record<string, number> = {
  email_needed: 422, checkout_not_open: 409, item_not_available: 409, already_member: 409, no_capacity: 409, too_many_open_orders: 429,
  order_beneficiary_not_allowed: 403, gift_item_not_allowed: 403, order_not_authorised: 403,
  membership_not_open: 409, quote_changed: 409, sponsor_billing_not_open: 409, order_fully_covered: 409, discount_code_invalid: 422, discount_code_rate_limited: 429, sponsor_budget_exhausted: 409, sponsor_payment_not_open: 409, already_paid: 409, order_closed: 409, payment_unavailable: 502, checkout_link_lost: 409, unknown: 500,
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
  // S29 pay for a loved one: an optional beneficiary. The database decides whether the caller may pay for them (an unexpired
  // Care Circle membership holding pay_for_care); this only checks the shape. The payer pays with their own card and email.
  const beneficiary = b["beneficiary"];
  if (beneficiary !== undefined && beneficiary !== null && (typeof beneficiary !== "string" || !UUID.test(beneficiary))) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  // S73: an optional discount code, an optional wish to use points, and the total the person was shown. Shapes only; the database decides
  // whether the code works, whether points exist, and refuses the order if the total it computes now is not the one the person saw.
  const discount = b["discount_code"];
  if (discount !== undefined && discount !== null && (typeof discount !== "string" || !DISCOUNT.test(discount.trim()))) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const usePoints = b["use_points"];
  if (usePoints !== undefined && usePoints !== null && typeof usePoints !== "boolean") return Response.json({ error: "invalid_input" }, { status: 400 });
  const expected = b["expected_amount_kobo"];
  if (expected !== undefined && expected !== null && (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const orders: OrderCreator = {
    async create(code, clientKey, ben, extras) {
      const args: Record<string, unknown> = { p_code: code, p_client_key: clientKey };
      if (ben) args["p_beneficiary"] = ben;
      if (extras?.discountCode) args["p_discount_code"] = extras.discountCode;
      if (extras?.usePoints) args["p_use_points"] = true;
      if (extras?.expectedAmountKobo !== undefined) args["p_expected_amount_kobo"] = extras.expectedAmountKobo;
      const { data, error } = await deps.rpcAsUser(auth, "create_order", args);
      if (error) return { ok: false, code: mapOrderError(error.message) };
      const d = data as Record<string, unknown> | null;
      // a code that cannot be used comes back as a result, not an error, so the failed try is kept by the database
      if (d && d["order_id"] === null && typeof d["error"] === "string") return { ok: false, code: mapOrderError(d["error"]) };
      if (!d || typeof d["order_id"] !== "string" || typeof d["reference"] !== "string" || typeof d["amount_kobo"] !== "number") return { ok: false, code: "unknown" };
      const order: CreatedOrder = {
        orderId: d["order_id"], reference: d["reference"], amountKobo: d["amount_kobo"],
        state: typeof d["state"] === "string" ? d["state"] : "created",
        checkoutUrl: typeof d["checkout_url"] === "string" ? d["checkout_url"] : null,
        // S71: a sponsor pays the whole order, so there is no payment step (the order is already paid)
        ...(d["covered"] === true ? { covered: true, sponsorName: typeof d["sponsor_name"] === "string" ? d["sponsor_name"] : null } : {}),
      };
      return { ok: true, order };
    },
  };

  const r = await startCheckout({ payments: deps.payments, store: deps.store, orders }, {
    code: b["code"], clientKey: b["client_key"], email: me.email, callbackUrl: deps.returnUrl,
    ...(typeof beneficiary === "string" ? { beneficiary } : {}),
    ...(typeof discount === "string" ? { discountCode: discount.trim() } : {}),
    ...(usePoints === true ? { usePoints: true } : {}),
    ...(typeof expected === "number" ? { expectedAmountKobo: expected } : {}),
  });
  if (!r.ok) return Response.json({ error: r.code }, { status: STATUS[r.code] ?? 500 });
  // Fully covered: no checkout link exists and none is asked for. The reply says so, with the sponsor's name for "Covered by ...".
  if (r.covered) return Response.json({ covered: true, order_id: r.orderId, reference: r.reference, sponsor_name: r.sponsorName });
  return Response.json({ order_id: r.orderId, reference: r.reference, amount_kobo: r.amountKobo, checkout_url: r.checkoutUrl });
}
