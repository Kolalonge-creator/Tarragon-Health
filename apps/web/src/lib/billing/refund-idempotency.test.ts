import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  refundAmountMinor,
  refundIdempotencyKey,
  refundIdempotencyKeyFromWebhook,
  refundProviderEventId,
} from "./refund-idempotency";

const CANONICAL = resolve(__dirname, "refund-idempotency.ts");
const WEBHOOK = resolve(__dirname, "../../../../../supabase/functions/paystack-webhook/index.ts");
const BEGIN = "// >>> BEGIN SHARED REFUND IDEMPOTENCY";
const END = "// <<< END SHARED REFUND IDEMPOTENCY";

function sharedBlock(path: string): string {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(`${path} no longer contains the shared refund idempotency block`);
  }
  return source.slice(start, end + END.length);
}

/**
 * The cron's side of the key: what recordRefundLedgerEntry builds from
 * Paystack's POST /refund API response. Kept as a helper so every test below
 * compares the two ROUTES rather than two spellings of one expression.
 */
function cronKey(chargeReference: string, amountMinor: number): string | null {
  return refundIdempotencyKey({ chargeReference, amountMinor });
}

describe("the webhook copy of the key derivation", () => {
  it("is byte-identical to the canonical one", () => {
    // These two files cannot share an import (the edge function is deployed
    // by the Supabase CLI and never sees apps/web's module graph), so this is
    // the only thing standing between them and a silent divergence — which is
    // exactly the bug this whole module exists to fix.
    expect(sharedBlock(WEBHOOK)).toBe(sharedBlock(CANONICAL));
  });

  it("no longer keys anything on the length of the request body", () => {
    const source = readFileSync(WEBHOOK, "utf8");
    // `rawBody.length` was both wrong (it never matched the cron's key, so a
    // refund posted twice) and unsafe (two unrelated payloads of equal length
    // deduped each other). A content hash replaced it.
    expect(source).not.toContain("rawBody.length");
  });
});

describe("cron key vs webhook key, for the same refund", () => {
  const CHARGE = "T685158182305961";
  const AMOUNT = 500_000;

  it("agrees on the shape Paystack's refund.* events actually carry", () => {
    // The documented/reported shape: transaction_reference + a STRING amount,
    // and no `id` field at all — the shape that used to fall through to the
    // body length.
    expect(
      refundIdempotencyKeyFromWebhook({
        transaction_reference: CHARGE,
        reference: "refund_ref_should_be_ignored_if_transaction_reference_present",
        amount: "500000",
      }),
    ).toBe(cronKey(CHARGE, AMOUNT));
  });

  it("agrees when the charge arrives nested under transaction.reference", () => {
    expect(
      refundIdempotencyKeyFromWebhook({ transaction: { reference: CHARGE }, amount: AMOUNT }),
    ).toBe(cronKey(CHARGE, AMOUNT));
  });

  it("agrees when the charge arrives as a flat reference", () => {
    expect(refundIdempotencyKeyFromWebhook({ reference: CHARGE, amount: AMOUNT })).toBe(
      cronKey(CHARGE, AMOUNT),
    );
  });

  it("does not agree for a different charge or a different amount", () => {
    // Guards against a vacuous pass: if the key ignored its inputs, every
    // assertion above would hold for the wrong reasons.
    expect(refundIdempotencyKeyFromWebhook({ transaction_reference: "T-other", amount: AMOUNT }))
      .not.toBe(cronKey(CHARGE, AMOUNT));
    expect(refundIdempotencyKeyFromWebhook({ transaction_reference: CHARGE, amount: 400_000 }))
      .not.toBe(cronKey(CHARGE, AMOUNT));
  });
});

describe("a payload with no usable identifier", () => {
  it("yields null rather than a key, so nothing can post", () => {
    expect(refundIdempotencyKeyFromWebhook({ amount: 500_000 })).toBeNull();
    expect(refundIdempotencyKeyFromWebhook({ transaction_reference: "  ", amount: 500_000 })).toBeNull();
    expect(refundIdempotencyKeyFromWebhook({})).toBeNull();
    expect(refundIdempotencyKeyFromWebhook(null)).toBeNull();
  });

  it("yields null when the amount is missing, zero, negative or not a number", () => {
    const ref = { transaction_reference: "T1" };
    expect(refundIdempotencyKeyFromWebhook({ ...ref })).toBeNull();
    expect(refundIdempotencyKeyFromWebhook({ ...ref, amount: 0 })).toBeNull();
    expect(refundIdempotencyKeyFromWebhook({ ...ref, amount: -1 })).toBeNull();
    expect(refundIdempotencyKeyFromWebhook({ ...ref, amount: "abc" })).toBeNull();
    expect(refundIdempotencyKeyFromWebhook({ ...ref, amount: 1.5 })).toBeNull();
  });
});

describe("the three refund.* stages of one refund", () => {
  const key = refundIdempotencyKey({ chargeReference: "T1", amountMinor: 500_000 })!;

  it("records only refund.processed under the key the cron writes", () => {
    expect(refundProviderEventId("refund.processed", key)).toBe(key);
  });

  it("namespaces pending and failed, so they cannot swallow the reversal", () => {
    // All three events describe the SAME refund and derive the same key. If
    // refund.pending were recorded under the bare key it would win the unique
    // index, the refund.processed that followed would be dismissed as a replay,
    // and the reversal would never post at all.
    expect(refundProviderEventId("refund.pending", key)).not.toBe(key);
    expect(refundProviderEventId("refund.failed", key)).not.toBe(key);
    expect(refundProviderEventId("refund.pending", key)).not.toBe(
      refundProviderEventId("refund.failed", key),
    );
  });
});

describe("refundAmountMinor", () => {
  it("accepts a positive integer as a number or a string", () => {
    expect(refundAmountMinor(500_000)).toBe(500_000);
    expect(refundAmountMinor(" 500000 ")).toBe(500_000);
  });

  it("rejects everything that would post nothing or post wrongly", () => {
    expect(refundAmountMinor(null)).toBeNull();
    expect(refundAmountMinor(undefined)).toBeNull();
    expect(refundAmountMinor(0)).toBeNull();
    expect(refundAmountMinor("")).toBeNull();
    expect(refundAmountMinor(Number.NaN)).toBeNull();
  });
});
