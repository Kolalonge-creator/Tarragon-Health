import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { refundTransaction } from "@/lib/paystack/refunds";
import { recordRefundLedgerEntry } from "@/lib/billing/refund-posting";

/**
 * Sweep for `service_purchase_refund_queue` rows —
 * public.decide_purchase_guarantee_refund() creates one whenever an admin
 * approves a first-purchase money-back guarantee claim
 * (service_purchase_guarantee_claims) that was paid by card. Mirrors the
 * voucher-cancellation-refunds cron's shape exactly: select rows still
 * `due`, call Paystack's refund API, mark `refunded` on success. A failure
 * is left `due` and retried on the next run rather than silently dropped,
 * up to a small attempt cap — past that, it stays `failed` for a human to
 * chase manually rather than retrying forever against what's probably a
 * dead reference.
 *
 * The GL side of a guarantee refund is split across two moments, by
 * design (see 20260924210805_first_purchase_guarantee_refunds.sql's
 * header): the original payment entry (and any already-recognised revenue
 * tranches) is reversed SYNCHRONOUSLY the moment an admin approves, via
 * private.finance_reverse_entry — that part is done before this cron ever
 * runs. This cron's recordRefundLedgerEntry call records the separate,
 * later event of the cash actually leaving the account once Paystack
 * processes the refund (Dr 4900 Refunds / Cr 1020 Cash, via the same
 * finance_post_from_payment refund branch every other refund cron uses).
 *
 * The platform_credit-paid half of a guarantee refund never reaches this
 * queue at all — decide_purchase_guarantee_refund() restores that balance
 * synchronously via public.correct_platform_credit(), so this cron only
 * ever sees provider='paystack' rows.
 *
 * Paystack only, same as every other refund cron on this platform — Stripe
 * was removed 2026-09-03 and never had a live account behind it.
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron
 * routes.
 */
const MAX_ATTEMPTS = 5;

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: due } = await supabase
    .from("service_purchase_refund_queue")
    .select(
      "id, service_purchase_id, guarantee_claim_id, provider, provider_reference, amount_minor, currency, attempts, service_purchase:service_purchases!inner(organisation_id)",
    )
    .eq("status", "due")
    .lt("attempts", MAX_ATTEMPTS);

  let refunded = 0;
  let failed = 0;
  let skippedUnconfigured = 0;
  // See video-visit-refunds: a refund that moved real money but no ledger is
  // reported, never counted as a clean success.
  let unpostedRefunds = 0;
  // A refund whose ledger row was already there. Normally the Paystack
  // webhook having posted the same reversal first, which is the whole point
  // of the shared idempotency key — but counted rather than ignored, because
  // it is also what a second refund of the same charge for the same amount
  // would look like (see lib/billing/refund-idempotency.ts).
  let alreadyPosted = 0;

  for (const row of due ?? []) {
    if (row.provider !== "paystack") {
      // Not a provider this route knows how to refund — leave it `due`
      // rather than guess.
      skippedUnconfigured += 1;
      continue;
    }
    if (!isPaystackConfigured()) {
      skippedUnconfigured += 1;
      continue;
    }
    const result = await refundTransaction({
      reference: row.provider_reference,
      amountKobo: row.amount_minor,
    });
    if (result.ok) {
      await supabase
        .from("service_purchase_refund_queue")
        .update({ status: "refunded", provider_refund_ref: String(result.data.refundId) })
        .eq("id", row.id);
      const posting = await recordRefundLedgerEntry(supabase, {
        refundId: String(result.data.refundId),
        chargeReference: row.provider_reference,
        amountMinor: row.amount_minor,
        currency: row.currency,
        organisationId: row.service_purchase?.organisation_id ?? null,
        source: "service_purchase_guarantee",
        sourceId: row.id,
      });
      if (posting.error) unpostedRefunds += 1;
      if (posting.alreadyPosted) alreadyPosted += 1;
      refunded += 1;
    } else {
      await supabase
        .from("service_purchase_refund_queue")
        .update({ attempts: row.attempts + 1, last_error: result.error })
        .eq("id", row.id);
      failed += 1;
    }
  }

  // Give up retrying (mark 'failed') past the attempt cap, without ever
  // discarding the row a human needs to resolve manually.
  await supabase
    .from("service_purchase_refund_queue")
    .update({ status: "failed" })
    .eq("status", "due")
    .gte("attempts", MAX_ATTEMPTS);

  return Response.json({
    refunded,
    refund_failures: failed,
    skipped_unconfigured: skippedUnconfigured,
    unposted_refunds: unpostedRefunds,
    already_posted_refunds: alreadyPosted,
  });
}
