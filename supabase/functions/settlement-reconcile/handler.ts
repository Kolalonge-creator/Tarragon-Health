// S14x: POST /functions/v1/settlement-reconcile. Compares Paystack's settlement report with our ledger. READ ONLY against Paystack
// (the adapter's two list calls are the only requests sent) and OPEN-BREAKS ONLY against the database: it never posts, corrects or
// refunds anything. A person explains each break in the admin queue. Called with a shared secret header (not scheduled yet: the
// vault secret and cron entry are a deploy step, see the closeout). Fails closed without its secret. Never throws.
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";
import type { PaymentProvider } from "../_shared/integrations/payment.ts";
import { syncSettlements, type SyncRpc } from "../_shared/integrations/settlement-sync.ts";

export interface SettlementReconcileDeps {
  readonly secret: string | null;
  readonly payments: PaymentProvider | null;
  readonly db: SyncRpc;
  readonly nowMs: () => number;
  /** From the active provider_layer_config row; the default matches the seed. */
  readonly lookbackDays?: number;
}

const DAY = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export async function handleSettlementReconcile(req: Request, deps: SettlementReconcileDeps): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("x-settlement-reconcile-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!deps.payments) return Response.json({ error: "payment_unavailable" }, { status: 503 });
  const now = deps.nowMs();
  const result = await syncSettlements({ payments: deps.payments, db: deps.db }, { from: isoDay(now - (deps.lookbackDays ?? 7) * DAY), to: isoDay(now + DAY) });
  if (!result.ok) return Response.json({ error: "sync_failed", retryable: result.error.retryable }, { status: 502 });
  return Response.json(result.data);
}
