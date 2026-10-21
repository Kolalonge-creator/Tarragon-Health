import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

import type { recordRefundLedgerEntry as RecordRefundLedgerEntry } from "./refund-posting";

type ServiceRoleClient = SupabaseClient<Database>;

type RefundCall = (args: { reference: string; amountKobo?: number }) => Promise<
  { ok: true; data: { refundId: number; status: string } } | { ok: false; error: string }
>;

/**
 * processed: Paystack took it and it is recorded.
 * failed: Paystack clearly refused it; recorded as failed, an admin may send it back to the queue.
 * unknown: no clear answer (a timeout, a network failure, or "already reversed"); left in `processing`, NOT retried, an incident raised.
 * skipped: not claimed (another run has it, or it is not claimable).
 */
export type SendOutcome = "processed" | "failed" | "unknown" | "skipped";

/** The claim answers this shape (public.claim_refund_for_provider). Anything else is treated as not claimed. */
interface Claim {
  result: string;
  refund_id?: string;
  organisation_id?: string;
  order_id?: string;
  amount_kobo?: number;
  charge_reference?: string;
}

function asClaim(v: unknown): Claim | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  return typeof o["result"] === "string" ? (o as unknown as Claim) : null;
}

/**
 * Did the provider answer with a clear refusal, or is the outcome unknown?
 *
 * A refund call that timed out or hit a network error may still have created the refund at Paystack, and "already reversed" means the money
 * HAS moved. Recording either as `failed` would make it retryable (a possible second refund) or leave a paid refund with no posting. So only
 * an answer that is plainly a rejection counts as a failure; everything else is unknown and waits for a person.
 */
export function classifyRefundError(message: string): { kind: "definitive" | "ambiguous"; code: string } {
  const m = message.toLowerCase();
  if ((m.includes("already") && (m.includes("revers") || m.includes("refund"))) || m.includes("fully refunded")) return { kind: "ambiguous", code: "already_refunded" };
  if (
    m.includes("abort") || m.includes("timeout") || m.includes("timed out") || m.includes("network") || m.includes("fetch failed") ||
    m.includes("econn") || m.includes("enotfound") || m.includes("socket") || m.includes("unknown paystack") || /status 5\d\d/.test(m) ||
    m.includes("not configured")
  ) {
    return { kind: "ambiguous", code: "network" };
  }
  if (m.includes("balance")) return { kind: "definitive", code: "insufficient_balance" };
  return { kind: "definitive", code: "provider_error" };
}

const RECORD_ATTEMPTS = 3;

/**
 * Send one approved order refund to Paystack (S26b).
 *
 * claim -> send -> record. The claim moves the row approved -> processing in one locked step BEFORE Paystack is called, so two overlapping
 * sweeps cannot both send it. The record moves processing -> completed or failed; on completed the database runs the reversal hook (deferred
 * revenue release and clinician share reversal). The cash posting (Dr 4900 / Cr 1020) is the existing refund.processed path.
 *
 * Nothing is dropped silently: a result that cannot be written is retried and then raised as an incident (the row stays `processing`, which
 * the hourly sweep also flags and an admin can settle); an unclear provider answer is raised and left alone; a failed cash posting is raised.
 *
 * Never throws.
 */
export async function sendApprovedOrderRefund(
  deps: {
    supabase: ServiceRoleClient;
    refundTransaction: RefundCall;
    recordRefundLedgerEntry: typeof RecordRefundLedgerEntry;
  },
  refundId: string,
): Promise<SendOutcome> {
  const { supabase } = deps;
  const { data: claimRaw, error: claimErr } = await supabase.rpc("claim_refund_for_provider", { p_refund: refundId });
  const claim = claimErr ? null : asClaim(claimRaw);
  if (!claim || claim.result !== "claimed" || !claim.charge_reference || typeof claim.amount_kobo !== "number") return "skipped";

  let result: Awaited<ReturnType<RefundCall>>;
  try {
    result = await deps.refundTransaction({ reference: claim.charge_reference, amountKobo: claim.amount_kobo });
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : "network" };
  }

  if (!result.ok) {
    const verdict = classifyRefundError(result.error);
    if (verdict.kind === "ambiguous") {
      await supabase.rpc("service_refund_incident", { p_refund: refundId, p_what: "ambiguous_provider_outcome" });
      return "unknown";
    }
    const failed = await writeResult(supabase, refundId, false, "", { error: result.error, error_code: verdict.code });
    if (!failed) await supabase.rpc("service_refund_incident", { p_refund: refundId, p_what: "record_failed" });
    return failed ? "failed" : "unknown";
  }

  const recorded = await writeResult(supabase, refundId, true, String(result.data.refundId), { status: result.data.status });
  if (!recorded) {
    // Paystack took the refund but we could not record it: the row stays `processing`. Raised now; the hourly sweep flags it again and an
    // admin settles it after checking the Paystack dashboard.
    await supabase.rpc("service_refund_incident", { p_refund: refundId, p_what: "record_failed" });
    return "unknown";
  }

  const posted = await deps.recordRefundLedgerEntry(supabase, {
    refundId: String(result.data.refundId),
    chargeReference: claim.charge_reference,
    amountMinor: claim.amount_kobo,
    currency: "NGN",
    organisationId: claim.organisation_id ?? null,
    source: "order",
    sourceId: claim.order_id ?? refundId,
  });
  if (!posted.posted && !posted.alreadyPosted) {
    await supabase.rpc("service_refund_incident", { p_refund: refundId, p_what: posted.error ?? "unknown" });
  }
  return "processed";
}

/** Write the provider's answer, retrying a database error a few times. True once the database accepted it (including a replay). */
async function writeResult(
  supabase: ServiceRoleClient,
  refundId: string,
  success: boolean,
  reference: string,
  response: Record<string, string | number>,
): Promise<boolean> {
  for (let attempt = 0; attempt < RECORD_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.rpc("record_refund_provider_result", {
      p_refund: refundId,
      p_success: success,
      p_reference: reference,
      p_response: response,
    });
    if (!error) return true;
  }
  return false;
}
