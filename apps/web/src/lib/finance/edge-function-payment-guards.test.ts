import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source guards for two Edge Function fixes that jest cannot execute.
 *
 * Both files run under Deno and are deployed by the Supabase CLI, so nothing
 * in this test suite imports them and nothing else in CI would notice if
 * either fix were reverted or lost to a merge. The refund-idempotency drift
 * guard (lib/billing/refund-idempotency.test.ts) already establishes this
 * pattern for exactly the same reason.
 *
 * NOTE: both files are SOURCE-ONLY until somebody runs a deploy. A green
 * test here means the fix is committed, not that production has it.
 */

const WEBHOOK = resolve(__dirname, "../../../../../supabase/functions/paystack-webhook/index.ts");
const SENDER = resolve(
  __dirname,
  "../../../../../supabase/functions/send-pending-notifications/index.ts",
);

describe("paystack-webhook signature verification", () => {
  const source = readFileSync(WEBHOOK, "utf8");

  it("compares the signature in constant time, not with ===", () => {
    expect(source).toContain("function timingSafeEqual(");
    expect(source).toContain("return timingSafeEqual(signatureHeader, expected);");
  });

  it("no longer short-circuits on the first differing byte", () => {
    expect(source).not.toContain("return signatureHeader === expected;");
  });

  it("still fails closed when the webhook secret is unset", () => {
    // The forgery risk this whole function guards against: an unconfigured
    // secret must reject every event, never degrade open.
    expect(source).toContain("PAYSTACK_WEBHOOK_SECRET is not set");
  });
});

describe("paystack-webhook booking_order_type enum-cast guard", () => {
  const source = readFileSync(WEBHOOK, "utf8");

  // payment_transactions.booking_order_type is public.commission_type
  // (lab/pharmacy/referral/home_visit/delivery/service_purchase — confirmed
  // live 2026-09-18, no drift from the migration files). BookingOrderType
  // (checkout-metadata.ts) additionally has 'video_visit'/'lab_result_consult',
  // which were never added as commission_type labels because those two
  // booking kinds are doctor-time products Tarragon never commissions. The
  // webhook used to write metadata.booking_order_type into this column for
  // EVERY booking kind, which threw an implicit-cast error — silently,
  // because the UPDATE's own {error} was never checked — for a video-visit
  // or lab-result-consult charge.success, leaving that payment_transactions
  // row permanently missing processed_at/booking_order_id/booking_order_type
  // even though the booking itself (video_visit_requests/
  // lab_result_consult_requests) was correctly confirmed by the write just
  // above it.
  const bookingBlock = source.slice(
    source.indexOf('if (metadata.kind === "booking") {'),
    source.indexOf('} else if (metadata.kind === "subscription") {'),
  );

  it("only forwards booking_order_id/booking_order_type for the three commission_type booking kinds", () => {
    expect(bookingBlock).toContain("isCommissionedBookingType");
    expect(bookingBlock).toContain(
      'bookingOrderType === "lab" || bookingOrderType === "pharmacy" || bookingOrderType === "referral"',
    );
    // The old unconditional write must be gone — it's what caused the silent
    // enum-cast failure for video_visit/lab_result_consult.
    expect(bookingBlock).not.toMatch(/booking_order_id:\s*row\.id,\s*booking_order_type:\s*bookingOrderType,\s*\}\);/);
  });

  it("checks the booking confirmation UPDATE's own error instead of dropping it", () => {
    expect(bookingBlock).toContain("const { error: confirmError } = await supabase");
    expect(bookingBlock).toContain("if (confirmError) {");
  });
});

describe("paystack-webhook markProcessed/markFailed no longer swallow their own error", () => {
  const source = readFileSync(WEBHOOK, "utf8");
  const helpers = source.slice(
    source.indexOf("const markProcessed = async"),
    source.indexOf("const metadata = event.data?.metadata"),
  );

  it("markProcessed checks {error} and logs it", () => {
    expect(helpers).toContain("const { error } = await supabase");
    expect(helpers).toContain('console.error("paystack-webhook: failed to mark payment_transactions processed"');
  });

  it("markFailed checks {error} and logs it", () => {
    expect(helpers).toContain("const { error: updateError } = await supabase");
    expect(helpers).toContain(
      'console.error("paystack-webhook: failed to record payment_transactions failure"',
    );
  });

  it("no longer fires-and-forgets the payment_transactions UPDATE (old unchecked one-liners are gone)", () => {
    expect(source).not.toContain(
      'const markProcessed = (patch: Record<string, unknown> = {}) =>\n    supabase.from("payment_transactions")',
    );
    expect(source).not.toContain(
      'const markFailed = (error: string) =>\n    supabase.from("payment_transactions")',
    );
  });
});

describe("send-pending-notifications sponsor_monthly_report", () => {
  const source = readFileSync(SENDER, "utf8");
  // Comment lines are stripped: the fix's own header explains what the old
  // payload shape was, and a guard that matched its own explanation would
  // fail forever.
  const template = source
    .slice(
      source.indexOf("sponsor_monthly_report: (payload) => {"),
      source.indexOf("lab_order_patient_confirmation: (payload) => {"),
    )
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("reads the flat keys private.queue_sponsor_monthly_reports actually emits", () => {
    for (const key of ["beneficiary_name", "spent_naira", "used_this_month", "ready_count"]) {
      expect(template).toContain(`payload.${key}`);
    }
  });

  it("no longer reads the Health-Wallet-era payload shape retired in 20260731215735", () => {
    expect(template).not.toContain("payload.people");
    expect(template).not.toContain("spent_kobo");
    expect(template).not.toContain("balance_kobo");
  });

  it("does not divide spent_naira by 100 — the producer already converted it", () => {
    // The latent 100x error: reconnecting spent_naira to the old money()
    // helper would have rendered ₦500 as ₦5.
    expect(template).not.toContain("/ 100");
  });
});
