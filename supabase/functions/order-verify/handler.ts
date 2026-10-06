// S25: POST /functions/v1/order-verify. The app (or the web return page) asks "is my order paid?" after the patient comes back
// from Paystack. A browser return is NEVER proof of payment: this asks Paystack itself, through the same verify-then-record path
// the webhook and the sweeper use, so it is safe to call repeatedly and cannot pay an order twice. Only the order's buyer or
// beneficiary can ask (order_for_checkout is run with their own JWT).
import { confirmPayment, type CommerceDeps } from "../_shared/commerce/index.ts";

export interface VerifyDeps {
  readonly commerce: CommerceDeps | null;
  readonly rpcAsUser: (authorization: string, fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const REF = /^[A-Za-z0-9._=-]{8,100}$/;

export async function handleVerify(req: Request, deps: VerifyDeps): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Response.json({ error: "unauthorised" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const ref = (body as { reference?: unknown } | null)?.reference;
  if (typeof ref !== "string" || !REF.test(ref)) return Response.json({ error: "invalid_input" }, { status: 400 });

  const read = () => deps.rpcAsUser(auth, "order_for_checkout", { p_reference: ref });
  const before = await read();
  if (before.error) return Response.json({ error: "unauthorised" }, { status: 401 });
  const order = before.data as { state?: string } | null;
  if (!order) return Response.json({ error: "not_found" }, { status: 404 });
  if (order.state === "paid" || order.state === "refunded") return Response.json({ state: order.state, outcome: "replay" });
  if (!deps.commerce) return Response.json({ error: "payment_unavailable" }, { status: 503 });

  const c = await confirmPayment(deps.commerce, { reference: ref, source: "return" });
  if (c.outcome === "retry") return Response.json({ error: "try_again" }, { status: 503 });
  const after = await read();
  const state = (after.data as { state?: string } | null)?.state ?? order.state ?? "created";
  return Response.json({ state, outcome: c.outcome });
}
