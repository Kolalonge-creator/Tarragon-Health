// S26b: deployed entrypoint for refund-reconcile. Wiring only; the logic and its header are in handler.ts.
// Endpoint and field names follow Paystack's published "Fetch Refund" reference and have NOT run against a live account (no credentials
// exist yet): the first real run is the check, and parseProviderRefund is the one place to correct if a field differs.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleRefundReconcile, parseProviderRefund, type ProviderRefund, type ReconcileStore } from "./handler.ts";

import { withSentry } from "../_shared/observability/sentry.ts";
Deno.serve(withSentry("refund-reconcile", (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paystack = Deno.env.get("PAYSTACK_SECRET_KEY");
  const service = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

  const store: ReconcileStore | null = service
    ? {
        async list(limit) {
          const { data, error } = await service.rpc("refunds_needing_reconcile", { p_limit: limit });
          return error || !Array.isArray(data) ? { ok: false } : { ok: true, rows: data };
        },
        async record(refundId, providerStatus, providerAmountKobo) {
          const { data, error } = await service.rpc("record_refund_reconcile", {
            p_refund: refundId,
            p_provider_status: providerStatus,
            p_provider_amount_kobo: providerAmountKobo,
          });
          return error || typeof data !== "string" ? null : data;
        },
        async flagDelays() {
          const { data, error } = await service.rpc("service_flag_refund_delays");
          return error || typeof data !== "number" ? null : data;
        },
        async catchUp() {
          const { data, error } = await service.rpc("service_run_refund_catch_up");
          return error || typeof data !== "number" ? null : data;
        },
      }
    : null;

  const fetchRefund = paystack
    ? async (chargeReference: string): Promise<ProviderRefund> => {
        try {
          const res = await fetch(`https://api.paystack.co/refund/${encodeURIComponent(chargeReference)}`, {
            headers: { Authorization: `Bearer ${paystack}` },
            signal: AbortSignal.timeout(10_000),
          });
          const json: unknown = await res.json().catch(() => null);
          return parseProviderRefund(res.status, json);
        } catch {
          return { status: null, amountKobo: null };
        }
      }
    : null;

  return handleRefundReconcile(req, { secret: Deno.env.get("REFUND_RECONCILE_SECRET") ?? null, store, fetchRefund });
}));
