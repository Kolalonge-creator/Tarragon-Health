import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

type ServiceRoleClient = SupabaseClient<Database>;

/**
 * Records a completed Paystack refund so the ledger actually reverses.
 *
 * The gap this closes: the three refund crons
 * (api/cron/{video-visit,pharmacy-order,voucher-cancellation}-refunds) each
 * called Paystack's /refund endpoint and then only flipped a status column.
 * No journal entry was written anywhere. A refunded ₦5,000 video visit left
 * ₦5,000 of cash and revenue sitting on the books that was not in the bank,
 * with nothing to surface the discrepancy. The refund posting branch in
 * private.finance_post_from_payment (Dr 4900 Refunds / Cr 1020 Cash) existed
 * but was unreachable — public.payment_transaction_type had no 'refund.*'
 * label until migration 20260905000134, so nothing could ever carry an
 * event_type the branch would match.
 *
 * Rather than invent a second posting path, this writes the same
 * payment_transactions row the Paystack webhook would write for the
 * corresponding `refund.processed` event, with processed_at already set.
 * That fires the existing finance_post_payment_processed trigger, which
 * calls finance_post_from_payment, which takes the refund branch. Every
 * other AFTER INSERT trigger on payment_transactions gates on
 * event_type IN ('charge.success', 'checkout.session.completed'), so a
 * refund row is inert to all of them — it activates nothing.
 *
 * Idempotency is the database's, not ours: (provider, provider_event_id) is
 * unique, and `refund:<refundId>` is exactly the key the webhook derives for
 * the same refund. Whichever of the two arrives second conflicts and posts
 * nothing, so a refund can never be double-reversed — and a cron re-run over
 * a row whose status update failed cannot double-post either.
 *
 * Never throws, and never reports failure to the caller as success: a
 * refund whose ledger entry could not be written is returned as
 * `{ posted: false, error }` so the cron can count it, rather than being
 * swallowed the way the missing posting was.
 */
export async function recordRefundLedgerEntry(
  supabase: ServiceRoleClient,
  args: {
    /** Paystack's own refund id — the idempotency key. */
    refundId: string;
    /** The reference of the ORIGINAL charge, for the audit trail. */
    chargeReference: string;
    /** Amount actually refunded, in the currency's minor unit. */
    amountMinor: number;
    currency: Database["public"]["Enums"]["currency"];
    /** Scopes the journal lines. Null only if the source row has no org. */
    organisationId: string | null;
    /** What was refunded — recorded in raw_payload for reconciliation. */
    source: string;
    sourceId: string;
  },
): Promise<{ posted: boolean; error?: string }> {
  if (!Number.isFinite(args.amountMinor) || args.amountMinor <= 0) {
    // finance_post_from_payment returns early on a non-positive amount, so a
    // row here would be an audit record that silently posts nothing. Say so.
    return { posted: false, error: "refund amount is missing or not positive" };
  }

  const { error } = await supabase.from("payment_transactions").insert({
    provider: "paystack",
    provider_event_id: `refund:${args.refundId}`,
    event_type: "refund.processed",
    amount_minor: args.amountMinor,
    currency: args.currency,
    organisation_id: args.organisationId,
    processed_at: new Date().toISOString(),
    raw_payload: {
      event: "refund.processed",
      source: "tarragon-refund-cron",
      data: {
        id: args.refundId,
        amount: args.amountMinor,
        currency: args.currency,
        transaction: { reference: args.chargeReference },
        tarragon: { source: args.source, source_id: args.sourceId },
      },
    },
  });

  if (error) {
    // 23505 means the Paystack webhook already recorded this exact refund and
    // the reversal is already posted. That is the intended outcome, not a
    // failure.
    if (error.code === "23505") return { posted: false };
    return { posted: false, error: error.message };
  }
  return { posted: true };
}
