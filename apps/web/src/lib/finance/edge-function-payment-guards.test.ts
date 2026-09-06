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
