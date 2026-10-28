import { fail, ok, type ProviderResult } from "../integrations/result.ts";
import type { PaymentProvider } from "../integrations/payment.ts";
import { confirmPayment, type OrderStore } from "./orders.ts";
import type { RpcClient } from "./supabase-store.ts";

/**
 * Membership auto-renewal: the daily sweep. For each Membership that is due (ends within 3 days, on automatic renewal, with a saved
 * card, switch ON; all decided in SQL), it
 *   1. verifies any EARLIER attempt for the same year with Paystack first, so a charge that went through but never confirmed is
 *      never charged a second time;
 *   2. asks the database to prepare ONE new renewal order (the database enforces the window, the 3-tries-a-day-apart limit, and
 *      hands back the saved card only to this service-role caller);
 *   3. charges the saved card;
 *   4. confirms the charge through the SAME confirmPayment the webhook uses, so the payment, the extension from the old end date,
 *      the ledger posting and the notice all happen in the one place they always do;
 *   5. records how the attempt ended (told to the person on the first miss and the last).
 * It never throws and never logs the card. A dropped connection after the charge request is recorded as PENDING, not failed: the
 * next run verifies it (step 1) before trying again.
 */
export interface PreparedRenewal {
  readonly orderId: string;
  readonly reference: string;
  readonly amountKobo: number;
  readonly email: string;
  readonly authorizationCode: string;
  readonly attemptNo: number;
}
export type PrepareResult = { readonly prepared: PreparedRenewal } | { readonly skip: string };

export interface RenewalStore {
  due(limit: number): Promise<ProviderResult<readonly string[]>>;
  /** References of EARLIER attempts for this membership's current year that are not yet known to be paid. */
  openReferences(membershipId: string): Promise<ProviderResult<readonly string[]>>;
  prepare(membershipId: string): Promise<ProviderResult<PrepareResult>>;
  recordAttempt(reference: string, outcome: "charged" | "failed" | "pending", error: string | null): Promise<ProviderResult<boolean>>;
  /** Reports that a run happened (and how it went) so the watchdog can tell a sweep that silently stopped from one with nothing to do. */
  recordRun(succeeded: boolean, summary: RenewalSummary | null): Promise<ProviderResult<boolean>>;
}

export interface RenewalDeps {
  readonly payments: PaymentProvider;
  readonly store: OrderStore;
  readonly renewals: RenewalStore;
}

export interface RenewalSummary {
  readonly considered: number;
  readonly renewed: number;
  readonly failed: number;
  readonly pending: number;
  readonly skipped: number;
  readonly alreadyPaid: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

export async function runRenewals(deps: RenewalDeps, opts: { readonly limit?: number } = {}): Promise<ProviderResult<RenewalSummary>> {
  const due = await deps.renewals.due(opts.limit ?? 50);
  if (!due.ok) return due;
  let renewed = 0, failed = 0, pending = 0, skipped = 0, alreadyPaid = 0;

  for (const membershipId of due.data) {
    // 1. an earlier attempt may have been paid without us hearing; look before charging again
    const open = await deps.renewals.openReferences(membershipId);
    if (!open.ok) { skipped += 1; continue; }
    let settled: "paid" | "wait" | "none" = "none";
    for (const reference of open.data) {
      const c = await confirmPayment({ payments: deps.payments, store: deps.store }, { reference, source: "sweep" });
      if (c.outcome === "paid" || c.outcome === "replay") { settled = "paid"; break; }
      // still moving, or we could not find out: do not risk a second charge today
      if (c.outcome === "pending" || c.outcome === "retry" || c.outcome === "mismatch") { settled = "wait"; break; }
    }
    if (settled === "paid") { alreadyPaid += 1; continue; }
    if (settled === "wait") { pending += 1; continue; }

    // 2. one new order, or a reason not to
    const p = await deps.renewals.prepare(membershipId);
    if (!p.ok) { skipped += 1; continue; }
    if ("skip" in p.data) { skipped += 1; continue; }
    const r = p.data.prepared;

    // 3. charge
    const charged = await deps.payments.chargeAuthorization({
      reference: r.reference,
      email: r.email,
      amountKobo: r.amountKobo,
      authorizationCode: r.authorizationCode,
      // renewal_expected_kobo lets confirmPayment tell price from price-plus-fee if Paystack adds a fee and reports no separate requested amount
      metadata: { kind: "order", order_id: r.orderId, renewal: true, renewal_expected_kobo: r.amountKobo },
    });
    if (!charged.ok) {
      // A timeout or dropped connection may hide a charge that went through: record PENDING and let the next run verify it.
      const lost = charged.error.code === "network" || charged.error.code === "timeout";
      await deps.renewals.recordAttempt(r.reference, lost ? "pending" : "failed", lost ? "no answer from the processor" : charged.error.message.slice(0, 200));
      if (lost) pending += 1; else failed += 1;
      continue;
    }
    if (charged.data.status === "pending") {
      await deps.renewals.recordAttempt(r.reference, "pending", "the processor has not finished the charge");
      pending += 1;
      continue;
    }
    if (charged.data.status !== "success") {
      await deps.renewals.recordAttempt(r.reference, "failed", `charge ${charged.data.status}`);
      failed += 1;
      continue;
    }

    // 4. the same confirm path as the webhook: verify with Paystack, match the order exactly, record, extend, post, notify
    const c = await confirmPayment({ payments: deps.payments, store: deps.store }, { reference: r.reference, source: "sweep" });
    if (c.outcome === "paid" || c.outcome === "replay") {
      await deps.renewals.recordAttempt(r.reference, "charged", null);
      renewed += 1;
    } else if (c.outcome === "pending" || c.outcome === "retry") {
      await deps.renewals.recordAttempt(r.reference, "pending", "charged; confirmation will follow");
      pending += 1;
    } else {
      await deps.renewals.recordAttempt(r.reference, "failed", `confirm: ${c.outcome}`);
      failed += 1;
    }
  }
  return ok({ considered: due.data.length, renewed, failed, pending, skipped, alreadyPaid });
}

/** The database half. Every call is a SECURITY DEFINER function that only the service role may run. */
export function supabaseRenewalStore(client: RpcClient): RenewalStore {
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
    async due(limit) {
      const r = await call("service_due_membership_renewals", { p_limit: limit });
      if (!r.ok) return r;
      if (!Array.isArray(r.data)) return fail("bad_response", "Unexpected reply from service_due_membership_renewals");
      return ok(r.data.flatMap((row) => (isObj(row) && typeof row["membership_id"] === "string" ? [row["membership_id"]] : [])));
    },
    async openReferences(membershipId) {
      const r = await call("service_renewal_open_references", { p_membership: membershipId });
      if (!r.ok) return r;
      if (!Array.isArray(r.data)) return fail("bad_response", "Unexpected reply from service_renewal_open_references");
      return ok(r.data.flatMap((row) => (isObj(row) && typeof row["reference"] === "string" ? [row["reference"]] : [])));
    },
    async prepare(membershipId) {
      const r = await call("service_prepare_membership_renewal", { p_membership: membershipId });
      if (!r.ok) return r;
      const d = r.data;
      if (!isObj(d)) return fail("bad_response", "Unexpected reply from service_prepare_membership_renewal");
      if (typeof d["skip"] === "string") return ok({ skip: d["skip"] });
      if (typeof d["order_id"] === "string" && typeof d["reference"] === "string" && typeof d["amount_kobo"] === "number" &&
          typeof d["email"] === "string" && typeof d["authorization_code"] === "string" && typeof d["attempt_no"] === "number") {
        return ok({ prepared: { orderId: d["order_id"], reference: d["reference"], amountKobo: d["amount_kobo"], email: d["email"], authorizationCode: d["authorization_code"], attemptNo: d["attempt_no"] } });
      }
      return fail("bad_response", "Unexpected reply from service_prepare_membership_renewal");
    },
    async recordRun(succeeded, summary) {
      const r = await call("service_record_renewal_run", { p_ok: succeeded, p_summary: summary ?? {} });
      return r.ok ? ok(true) : r;
    },
    async recordAttempt(reference, outcome, error) {
      const r = await call("service_record_renewal_attempt", { p_reference: reference, p_outcome: outcome, p_error: error });
      return r.ok ? ok(true) : r;
    },
  };
}
