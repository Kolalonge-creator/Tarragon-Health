// Membership auto-renewal: POST /functions/v1/membership-renewal. pg_cron calls this once a day (06:00 UTC) with a shared secret
// header, and only while the membership_auto_renew switch is ON. It charges the saved card of every Membership due to renew,
// through the same verify-then-record path as the webhook. Fails closed without its secret. Never throws; never logs a card.
import { runRenewals, type RenewalDeps } from "../_shared/commerce/index.ts";
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";

export const sameSecret = constantTimeEqual;

export async function handleRenewal(req: Request, deps: { readonly secret: string | null; readonly renewal: RenewalDeps | null }): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!sameSecret(req.headers.get("x-membership-renewal-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!deps.renewal) return Response.json({ error: "payment_unavailable" }, { status: 503 });
  const r = await runRenewals(deps.renewal);
  if (!r.ok) return Response.json({ error: "sweep_failed" }, { status: 500 });
  return Response.json(r.data);
}
