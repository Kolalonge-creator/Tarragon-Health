// S26b: POST /functions/v1/refund-reconcile. pg_cron calls this weekly with a shared secret header. For every refund the database says
// still needs checking (refunds_needing_reconcile) it asks Paystack what it knows about the refund and passes the answer to
// record_refund_reconcile, which decides match or mismatch in SQL (private.refund_reconcile_verdict) and raises an ops incident on a
// mismatch. It then asks the database to flag refunds that are late (undecided past the SLA, approved but never sent, stuck mid-send)
// and re-runs the reversal catch-up. This function changes no money and no refund state: it only reads Paystack and records the verdict.
// Fails closed without its secret. Never throws.
import { constantTimeEqual } from "../_shared/integrations/crypto.ts";

export const sameSecret = constantTimeEqual;

/** What Paystack said about one refund. `status` is Paystack's own word (kept as sent, lower case), or 'not_found', or null when it could not be asked. */
export interface ProviderRefund {
  readonly status: string | null;
  readonly amountKobo: number | null;
}

export interface ReconcileRow {
  readonly id: string;
  readonly state: string;
  readonly amount_kobo: number;
  readonly provider_reference: string | null;
  readonly charge_reference: string | null;
}

export interface ReconcileStore {
  list(limit: number): Promise<{ ok: true; rows: ReconcileRow[] } | { ok: false }>;
  record(refundId: string, providerStatus: string | null, providerAmountKobo: number | null): Promise<string | null>;
  flagDelays(): Promise<number | null>;
  catchUp(): Promise<number | null>;
}

export interface ReconcileDeps {
  readonly secret: string | null;
  readonly store: ReconcileStore | null;
  /** Asks Paystack about the refund of one charge. Must not throw; a failed call is `{ status: null }`. */
  readonly fetchRefund: ((chargeReference: string) => Promise<ProviderRefund>) | null;
}

const BATCH = 100;

export async function handleRefundReconcile(req: Request, deps: ReconcileDeps): Promise<Response> {
  if (!deps.secret) return Response.json({ error: "not configured" }, { status: 503 });
  if (!sameSecret(req.headers.get("x-refund-reconcile-secret") ?? "", deps.secret)) return Response.json({ error: "unauthorised" }, { status: 401 });
  if (!deps.store || !deps.fetchRefund) return Response.json({ error: "payment_unavailable" }, { status: 503 });

  const listed = await deps.store.list(BATCH);
  if (!listed.ok) return Response.json({ error: "list_failed" }, { status: 500 });

  let matched = 0;
  let flagged = 0;
  let unreachable = 0;
  let errors = 0;
  for (const row of listed.rows) {
    if (!row.charge_reference) {
      // No charge to ask about: record it as not found so the verdict (and the incident, for a completed refund) is the database's.
      const v = await deps.store.record(row.id, "not_found", null);
      if (v === null) errors += 1;
      else if (v === "matched") matched += 1;
      else flagged += 1;
      continue;
    }
    const seen = await deps.fetchRefund(row.charge_reference);
    if (seen.status === null) {
      // Paystack could not be asked. Nothing is recorded: a network failure must not look like a mismatch or a match.
      unreachable += 1;
      continue;
    }
    const v = await deps.store.record(row.id, seen.status, seen.amountKobo);
    if (v === null) errors += 1;
    else if (v === "matched") matched += 1;
    else flagged += 1;
  }

  const delays = await deps.store.flagDelays();
  const caughtUp = await deps.store.catchUp();
  if (delays === null || caughtUp === null) errors += 1;
  return Response.json({ checked: listed.rows.length, matched, flagged, unreachable, errors, delaysFlagged: delays ?? 0, caughtUp: caughtUp ?? 0 });
}

/** Paystack answers GET /refund/:transaction_reference with the refund (an object, or a list on some accounts). Pure so it is testable. */
export function parseProviderRefund(httpStatus: number, json: unknown): ProviderRefund {
  if (httpStatus === 404) return { status: "not_found", amountKobo: null };
  if (httpStatus < 200 || httpStatus >= 300 || typeof json !== "object" || json === null) return { status: null, amountKobo: null };
  const data = (json as Record<string, unknown>)["data"];
  const first = Array.isArray(data) ? data[0] : data;
  if (first === undefined || first === null) return { status: "not_found", amountKobo: null };
  if (typeof first !== "object") return { status: null, amountKobo: null };
  const o = first as Record<string, unknown>;
  const status = typeof o["status"] === "string" ? o["status"].toLowerCase() : null;
  const amount = typeof o["amount"] === "number" && Number.isSafeInteger(o["amount"]) ? o["amount"] : null;
  return { status, amountKobo: amount };
}
