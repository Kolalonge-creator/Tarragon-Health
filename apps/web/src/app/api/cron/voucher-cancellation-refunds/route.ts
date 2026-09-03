import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { refundTransaction } from "@/lib/paystack/refunds";

/**
 * Sweep for `voucher_refund_queue` rows cancel_care_voucher() creates —
 * mirrors the video-visit-refunds cron's idempotent-flag-plus-retry-sweep
 * shape exactly: select rows still `due`, call Paystack's refund API, mark
 * `refunded` on success. A failure is left `due` and retried on the next
 * run rather than silently dropped, up to a small attempt cap — past that,
 * it stays `failed` for a human to chase manually rather than retrying
 * forever against what's probably a dead reference.
 *
 * Paystack only. Stripe refund handling is removed 2026-09-03 along with
 * the rest of the Stripe integration — there was never a registered Stripe
 * account behind it, and the only `provider='stripe'` row this platform
 * ever had was test data, deleted in the same migration that dropped
 * Stripe. Any future `provider !== 'paystack'` row is left `due` rather
 * than guessed at, same as an unrecognised provider always was.
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
    .from("voucher_refund_queue")
    .select("id, provider, provider_reference, amount_minor, attempts")
    .eq("status", "due")
    .lt("attempts", MAX_ATTEMPTS);

  let refunded = 0;
  let failed = 0;
  let skippedUnconfigured = 0;

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
        .from("voucher_refund_queue")
        .update({ status: "refunded", provider_refund_ref: String(result.data.refundId) })
        .eq("id", row.id);
      refunded += 1;
    } else {
      await supabase
        .from("voucher_refund_queue")
        .update({ attempts: row.attempts + 1, last_error: result.error })
        .eq("id", row.id);
      failed += 1;
    }
  }

  // Give up retrying (mark 'failed') past the attempt cap, without ever
  // discarding the row a human needs to resolve manually.
  await supabase
    .from("voucher_refund_queue")
    .update({ status: "failed" })
    .eq("status", "due")
    .gte("attempts", MAX_ATTEMPTS);

  return Response.json({ refunded, refund_failures: failed, skipped_unconfigured: skippedUnconfigured });
}
