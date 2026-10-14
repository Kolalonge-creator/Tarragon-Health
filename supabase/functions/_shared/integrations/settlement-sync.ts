import { asObject } from "./http.ts";
import type { PaymentProvider, SettlementTransaction } from "./payment.ts";
import { fail, ok, type ProviderResult } from "./result.ts";

/**
 * Settlement report against our ledger (S14x, plan item R6). READ ONLY against Paystack: the adapter's list calls are the only
 * thing sent to the provider. What comes back is stored (`record_settlement_report`) and compared (`reconcile_settlement_report`,
 * `reconcile_unsettled_charges`) by database functions that only ever OPEN breaks. Nothing here posts, corrects or moves money;
 * a person explains each break in the admin queue. Safe to run as often as wanted: every step is idempotent.
 */
export interface SyncRpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}
export interface SyncDeps {
  readonly payments: PaymentProvider;
  readonly db: SyncRpc;
  /** Safety caps so a vendor that never says "no more pages" cannot hold the function open. */
  readonly maxSettlements?: number;
  readonly maxLinePages?: number;
}
export interface SyncResult {
  readonly settlements: number;
  readonly lines: number;
  readonly openBreaks: number;
  readonly incomplete: number;
  readonly unsettledChargesFlagged: number;
}

const PER_PAGE = 100;

async function db(client: SyncRpc, fn: string, args: Record<string, unknown>): Promise<ProviderResult<unknown>> {
  try {
    const { data, error } = await client.rpc(fn, args);
    return error ? fail("vendor_error", `${fn} failed`, true) : ok(data);
  } catch {
    return fail("network", `${fn} could not be reached`);
  }
}

export async function syncSettlements(deps: SyncDeps, window: { readonly from: string; readonly to: string }): Promise<ProviderResult<SyncResult>> {
  const maxSettlements = deps.maxSettlements ?? 100;
  const maxLinePages = deps.maxLinePages ?? 50;
  let settlements = 0;
  let lines = 0;
  let openBreaks = 0;
  let incomplete = 0;

  for (let page = 1; settlements < maxSettlements; page++) {
    const list = await deps.payments.listSettlements({ from: window.from, to: window.to, page, perPage: PER_PAGE });
    if (!list.ok) return list;
    for (const s of list.data.items) {
      if (settlements >= maxSettlements) break;
      const got: SettlementTransaction[] = [];
      let complete = false;
      for (let lp = 1; lp <= maxLinePages; lp++) {
        const part = await deps.payments.listSettlementTransactions(s.settlementId, { page: lp, perPage: PER_PAGE });
        if (!part.ok) return part;
        got.push(...part.data.items);
        if (!part.data.hasMore) {
          complete = true;
          break;
        }
      }
      const stored = await db(deps.db, "record_settlement_report", {
        p_settlement_id: s.settlementId, p_status: s.status, p_total_kobo: s.totalKobo, p_fees_kobo: s.feesKobo, p_settled_at: s.settledAt,
        p_lines: got.map((t) => ({ reference: t.reference, amount_kobo: t.amountKobo, fees_kobo: t.feesKobo, status: t.status, paid_at: t.paidAt })),
        p_lines_complete: complete,
      });
      if (!stored.ok) return stored;
      if (typeof stored.data !== "string") return fail("bad_response", "Unexpected reply from record_settlement_report");
      const compared = await db(deps.db, "reconcile_settlement_report", { p_report_id: stored.data });
      if (!compared.ok) return compared;
      const c = asObject(compared.data);
      openBreaks += typeof c?.["open_breaks"] === "number" ? c["open_breaks"] : 0;
      if (!complete) incomplete += 1;
      settlements += 1;
      lines += got.length;
    }
    if (!list.data.hasMore) break;
  }

  const unsettled = await db(deps.db, "reconcile_unsettled_charges", {});
  if (!unsettled.ok) return unsettled;
  return ok({ settlements, lines, openBreaks, incomplete, unsettledChargesFlagged: typeof unsettled.data === "number" ? unsettled.data : 0 });
}
