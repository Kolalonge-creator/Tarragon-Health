import { fail, ok, type ProviderResult } from "../integrations/result.ts";
import type { MismatchInput, OpenOrder, OrderStore, RecordOutcome, RecordPaymentInput, RecordResult } from "./orders.ts";

/** The slice of a Supabase client this store needs (a service-role client). Structural so tests need no vendor package. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const RESULTS: ReadonlySet<string> = new Set(["paid", "replay", "mismatch", "not_found", "not_paid"]);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function toOutcome(data: unknown): ProviderResult<RecordOutcome> {
  if (!isObj(data) || typeof data["result"] !== "string" || !RESULTS.has(data["result"])) return fail("bad_response", "Unexpected reply from record_order_payment");
  return ok({
    result: data["result"] as RecordResult,
    orderId: typeof data["order_id"] === "string" ? data["order_id"] : null,
    reason: typeof data["reason"] === "string" ? data["reason"] : null,
  });
}

/** The database half of the flows. Every call is a SECURITY DEFINER function that only the service role may run. */
export function supabaseOrderStore(client: RpcClient): OrderStore {
  const call = async (fn: string, args: Record<string, unknown>): Promise<ProviderResult<unknown>> => {
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error) return fail("vendor_error", `${fn} failed`, true);
      return ok(data);
    } catch {
      return fail("network", `${fn} could not be reached`);
    }
  };
  return {
    async record(i: RecordPaymentInput) {
      const r = await call("record_order_payment", {
        p_reference: i.reference, p_amount_kobo: i.amountKobo, p_fee_kobo: i.feeKobo, p_processor_fee_kobo: i.processorFeeKobo,
        p_total_kobo: i.totalKobo, p_currency: i.currency, p_status: "success", p_source: i.source, p_event_key: i.eventKey, p_paid_at: i.paidAt, p_raw: i.raw,
      });
      return r.ok ? toOutcome(r.data) : r;
    },
    async flagMismatch(i: MismatchInput) {
      const r = await call("flag_order_payment_mismatch", {
        p_reference: i.reference, p_reason: i.reason, p_amount_kobo: i.amountKobo, p_fee_kobo: i.feeKobo,
        p_total_kobo: i.totalKobo, p_source: i.source, p_event_key: i.eventKey, p_raw: i.raw,
      });
      return r.ok ? toOutcome(r.data) : r;
    },
    async close(reference, reason) {
      const r = await call("close_unpaid_order", { p_reference: reference, p_reason: reason });
      return r.ok ? ok(r.data === true) : r;
    },
    async listOpen(limit) {
      const r = await call("orders_needing_reconcile", { p_limit: limit });
      if (!r.ok) return r;
      if (!Array.isArray(r.data)) return fail("bad_response", "Unexpected reply from orders_needing_reconcile");
      const rows: OpenOrder[] = [];
      for (const row of r.data) {
        if (isObj(row) && typeof row["reference"] === "string" && typeof row["order_id"] === "string") {
          rows.push({ reference: row["reference"], orderId: row["order_id"], expired: row["expired"] === true });
        }
      }
      return ok(rows);
    },
    async setCheckoutUrl(reference, url) {
      const r = await call("set_order_checkout_url", { p_reference: reference, p_url: url });
      return r.ok ? ok(r.data === true) : r;
    },
  };
}
