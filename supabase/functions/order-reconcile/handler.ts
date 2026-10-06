// S25: POST /functions/v1/order-reconcile. pg_cron calls this every 5 minutes with a shared secret header. It asks Paystack about
// every unpaid order older than two minutes (a bank transfer or USSD payment can settle long after the customer left) and pays,
// closes or leaves each one through the same verify-then-record path as the webhook. Fails closed without its secret. Never throws.
import { reconcileOpenOrders, type CommerceDeps } from "../_shared/commerce/index.ts";
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";

export const sameSecret = constantTimeEqual;

export async function handleReconcile(req: Request, deps: { readonly secret: string | null; readonly commerce: CommerceDeps | null }): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!sameSecret(req.headers.get("x-order-reconcile-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!deps.commerce) return Response.json({ error: "payment_unavailable" }, { status: 503 });
  const r = await reconcileOpenOrders(deps.commerce);
  if (!r.ok) return Response.json({ error: "list_failed" }, { status: 500 });
  return Response.json(r.data);
}
