import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPaystackConfigured } from "@/lib/paystack/client";
import { refundTransaction } from "@/lib/paystack/refunds";

/**
 * Sweep for the video-visit held-payment model (Vercel Cron, see
 * vercel.json — runs every 4 hours so the 24h SLA below is actually close to
 * true, not "24-48h depending on time of day" the way a once-daily sweep
 * against a 24h cutoff would silently allow). Three passes:
 *   1. Doctor-engagement expiry — paid requests no doctor accepted OR
 *      proposed alternate times for within 24h flip to 'expired' with
 *      refund_status='due' (founder ask 2026-07-31, tightened from 48h: "a
 *      doctor will accept within 24 hours").
 *   2. Patient-selection expiry — once a doctor proposes alternate times
 *      (status='alternate_proposed'), the patient gets their own 24h window
 *      to pick one before it also expires+refunds. Same cutoff, different
 *      clock (proposed_at, not the request's original updated_at) — a
 *      doctor engaging on time must not be undone by the patient simply not
 *      choosing yet.
 *   3. Refunds — every declined/expired request with refund_status='due' and
 *      a real Paystack charge gets a full refund via the Refunds API;
 *      success marks it 'refunded'. Failures stay 'due' and retry next run —
 *      nothing is ever silently dropped. (Stripe-charged requests, if any
 *      appear once diaspora pricing exists, stay 'due' for manual handling —
 *      flagged in the response payload.)
 *
 * Verifies the Vercel-attached CRON_SECRET bearer, same as the other cron
 * routes.
 */
export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Not authorised", { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

  // Pass 1: expire unaccepted, un-proposed paid requests older than 24h.
  const { data: expiredUnaccepted } = await supabase
    .from("video_visit_requests")
    .update({ status: "expired", refund_status: "due" })
    .eq("status", "payment_confirmed")
    .lt("updated_at", cutoff)
    .not("payment_provider_ref", "is", null)
    .select("id, organisation_id, patient_id");

  for (const row of expiredUnaccepted ?? []) {
    await supabase.from("notifications").insert({
      organisation_id: row.organisation_id,
      recipient_id: row.patient_id,
      channel: "whatsapp",
      status: "pending",
      template: "video_visit_declined",
      payload: { reason: "No doctor was available in time — you will be refunded in full." },
    });
  }

  // Capitated requests (no payment ref) that aged out just expire quietly —
  // there is no money to return.
  await supabase
    .from("video_visit_requests")
    .update({ status: "expired" })
    .eq("status", "payment_confirmed")
    .lt("updated_at", cutoff)
    .is("payment_provider_ref", null);

  // Pass 2: expire proposals the patient never picked a time from.
  const { data: expiredUnselected } = await supabase
    .from("video_visit_requests")
    .update({ status: "expired", refund_status: "due" })
    .eq("status", "alternate_proposed")
    .lt("proposed_at", cutoff)
    .not("payment_provider_ref", "is", null)
    .select("id, organisation_id, patient_id");

  for (const row of expiredUnselected ?? []) {
    await supabase.from("notifications").insert({
      organisation_id: row.organisation_id,
      recipient_id: row.patient_id,
      channel: "whatsapp",
      status: "pending",
      template: "video_visit_declined",
      payload: { reason: "None of the offered times were picked in time — you will be refunded in full." },
    });
  }

  await supabase
    .from("video_visit_requests")
    .update({ status: "expired" })
    .eq("status", "alternate_proposed")
    .lt("proposed_at", cutoff)
    .is("payment_provider_ref", null);

  const expired = [...(expiredUnaccepted ?? []), ...(expiredUnselected ?? [])];

  // Pass 3: process due refunds.
  const { data: due } = await supabase
    .from("video_visit_requests")
    .select("id, payment_provider, payment_provider_ref")
    .eq("refund_status", "due")
    .in("status", ["declined", "expired"]);

  let refunded = 0;
  let manual = 0;
  let failed = 0;
  for (const row of due ?? []) {
    if (row.payment_provider !== "paystack" || !row.payment_provider_ref) {
      manual += 1;
      continue;
    }
    if (!isPaystackConfigured()) {
      failed += 1;
      continue;
    }
    const result = await refundTransaction({ reference: row.payment_provider_ref });
    if (result.ok) {
      await supabase
        .from("video_visit_requests")
        .update({ status: "refunded", refund_status: "refunded", refund_ref: String(result.data.refundId) })
        .eq("id", row.id);
      refunded += 1;
    } else {
      failed += 1;
    }
  }

  return Response.json({
    expired: expired.length,
    refunded,
    refund_failures: failed,
    needs_manual_refund: manual,
  });
}
