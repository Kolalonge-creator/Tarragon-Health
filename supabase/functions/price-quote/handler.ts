// S73: POST /functions/v1/price-quote. A thin wrapper over public.price_quote: the signed-in patient asks what an item costs THEM, for themselves or
// (with the right Care Circle permission) for someone else. Every number is computed by the database function that create_order also calls, so
// the quote and the charge cannot differ. The client sends an item code, an optional beneficiary, an optional discount code and a points
// wish; never an amount. The reply is the database's line-by-line explanation, shape-checked.
import { mapOrderError, parseQuote } from "../_shared/commerce/index.ts";

export interface QuoteDeps {
  readonly whoami: (authorization: string) => Promise<{ readonly id: string } | null>;
  /** price_quote run with the caller's JWT. */
  readonly rpcAsUser: (authorization: string, fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_]{2,63}$/;
const DISCOUNT = /^[A-Za-z0-9][A-Za-z0-9 -]{2,31}$/;

const STATUS: Record<string, number> = {
  checkout_not_open: 409, item_not_available: 409, membership_not_open: 409, order_beneficiary_not_allowed: 403, order_not_authorised: 403, unknown: 500,
};

export async function handleQuote(req: Request, deps: QuoteDeps): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!(await deps.whoami(auth))) return Response.json({ error: "unauthorised" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b["code"] !== "string" || !CODE.test(b["code"])) return Response.json({ error: "invalid_input" }, { status: 400 });
  const beneficiary = b["beneficiary"];
  if (beneficiary !== undefined && beneficiary !== null && (typeof beneficiary !== "string" || !UUID.test(beneficiary))) return Response.json({ error: "invalid_input" }, { status: 400 });
  const discount = b["discount_code"];
  if (discount !== undefined && discount !== null && (typeof discount !== "string" || !DISCOUNT.test(discount.trim()))) return Response.json({ error: "invalid_input" }, { status: 400 });
  const usePoints = b["use_points"];
  if (usePoints !== undefined && usePoints !== null && typeof usePoints !== "boolean") return Response.json({ error: "invalid_input" }, { status: 400 });

  const args: Record<string, unknown> = { p_code: b["code"] };
  if (typeof beneficiary === "string") args["p_beneficiary"] = beneficiary;
  if (typeof discount === "string") args["p_discount_code"] = discount.trim();
  if (usePoints === true) args["p_use_points"] = true;
  const { data, error } = await deps.rpcAsUser(auth, "price_quote", args);
  if (error) {
    const code = mapOrderError(error.message);
    return Response.json({ error: code }, { status: STATUS[code] ?? 500 });
  }
  const quote = parseQuote(data);
  if (!quote) return Response.json({ error: "unknown" }, { status: 500 });
  // the database's own JSON, once it has passed the shape check: line labels are i18n keys
  return Response.json(data);
}
