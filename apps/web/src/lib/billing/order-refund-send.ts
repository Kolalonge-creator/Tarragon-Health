import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

import type { recordRefundLedgerEntry as RecordRefundLedgerEntry } from "./refund-posting";

type ServiceRoleClient = SupabaseClient<Database>;

type RefundCall = (args: { reference: string; amountKobo?: number }) => Promise<
  { ok: true; data: { refundId: number; status: string } } | { ok: false; error: string }
>;

export type SendOutcome = "processed" | "failed" | "skipped";

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

/** A short, stable word for the failure. The provider's own text goes to provider_response only (never to a patient). */
function errorCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("already") && m.includes("revers")) return "already_refunded";
  if (m.includes("balance")) return "insufficient_balance";
  if (m.includes("timeout") || m.includes("network") || m.includes("fetch")) return "network";
  return "provider_error";
}

/**
 * Send one approved order refund to Paystack (S26b).
 *
 * claim -> send -> record. The claim moves the row approved -> processing in one locked step BEFORE Paystack is called, so two overlapping
 * sweeps cannot both send it and a crash after the claim leaves a visible `processing` row (the weekly reconcile flags it) instead of a
 * second send. The record moves processing -> completed or failed; on completed the database runs the reversal hook (deferred revenue
 * release and clinician share reversal). The cash posting (Dr 4900 / Cr 1020) is the existing refund.processed path; if it fails the
 * refund stays completed (the money really moved) and an ops incident is raised instead of the failure being dropped.
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
    await supabase.rpc("record_refund_provider_result", {
      p_refund: refundId,
      p_success: false,
      p_reference: "",
      p_response: { error: result.error, error_code: errorCode(result.error) },
    });
    return "failed";
  }

  const { error: recordErr } = await supabase.rpc("record_refund_provider_result", {
    p_refund: refundId,
    p_success: true,
    p_reference: String(result.data.refundId),
    p_response: { status: result.data.status },
  });
  if (recordErr) {
    // Paystack took the refund but we could not record it: the row stays `processing`, which the weekly reconcile and the delay flag raise.
    await supabase.rpc("service_refund_incident", { p_refund: refundId, p_what: "record_failed" });
    return "failed";
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
