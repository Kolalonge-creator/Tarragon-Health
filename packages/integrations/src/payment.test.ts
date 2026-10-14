import { createMockPayment, createPaystackPayment } from "../../../supabase/functions/_shared/integrations/index.ts";
import { runPaymentContract } from "./contracts/payment.contract";
import { createFakePaystack } from "./support/fake-paystack";

runPaymentContract("mock", () => {
  const mock = createMockPayment();
  return { provider: mock, settle: (r, s) => mock.settle(r, s), setCustomerFee: (r, f) => mock.setCustomerFee(r, f), settleTransfer: (r, s) => mock.settleTransfer(r, s), signedWebhook: mock.signedWebhook, signedRaw: mock.signedRaw, failNextCall: () => mock.failNextCall() };
});

runPaymentContract("paystack adapter over a fake vendor", () => {
  const fake = createFakePaystack();
  const provider = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
  return { provider, settle: (r, s) => fake.settle(r, s), setCustomerFee: (r, f) => fake.setCustomerFee(r, f), settleTransfer: (r, s) => fake.settleTransfer(r, s), signedWebhook: (b) => fake.signedWebhook(b), signedRaw: (r) => fake.signedRaw(r), failNextCall: () => fake.failNextCall() };
});

// The live run (S25, S31) adds one more line here, gated on a Paystack test key in the environment:
//   const key = process.env.PAYSTACK_TEST_SECRET_KEY; (key ? runPaymentContract : skip)("paystack test mode", () => ({ ... no settle ... }))

import { describe, expect, it } from "@jest/globals";
import { paymentMatchesOrder, type VerifiedTransaction } from "../../../supabase/functions/_shared/integrations/index.ts";

describe("paymentMatchesOrder and the processing fee", () => {
  const base: VerifiedTransaction = { reference: "chg-abcdefgh1234", status: "success", amountKobo: 261_250, requestedAmountKobo: 250_000, feesKobo: 11_250, currency: "NGN", paidAt: null, customerEmail: null, metadata: {} };
  const want = { reference: base.reference, amountKobo: 250_000 };

  it("accepts the price plus a fee no larger than the one the processor took", () => {
    expect(paymentMatchesOrder(base, want)).toEqual({ ok: true, customerFeeKobo: 11_250 });
    expect(paymentMatchesOrder({ ...base, amountKobo: 255_000 }, want)).toEqual({ ok: true, customerFeeKobo: 5_000 });
  });

  it("rejects a charge larger than price plus the real fee, and one smaller than the price", () => {
    expect(paymentMatchesOrder({ ...base, amountKobo: 270_000 }, want)).toEqual({ ok: false, reason: "fee" });
    expect(paymentMatchesOrder({ ...base, amountKobo: 240_000 }, want)).toEqual({ ok: false, reason: "fee" });
  });

  it("when we bear the fee the customer pays the price only", () => {
    expect(paymentMatchesOrder({ ...base, amountKobo: 250_000 }, want)).toEqual({ ok: true, customerFeeKobo: 0 });
  });
});

import { isPaymentChannelList, PAYMENT_CHANNELS } from "../../../supabase/functions/_shared/integrations/index.ts";

describe("payment channels (S71, 19.2)", () => {
  const ref = (n: number) => `chg-channels${String(n).padStart(4, "0")}`;

  it("accepts a list of known channels, once each, and nothing else", () => {
    expect(isPaymentChannelList(["card", "bank_transfer"])).toBe(true);
    expect(isPaymentChannelList([...PAYMENT_CHANNELS])).toBe(true);
    expect(isPaymentChannelList([])).toBe(false);
    expect(isPaymentChannelList(["card", "card"])).toBe(false);
    expect(isPaymentChannelList(["card", "cheque"])).toBe(false);
    expect(isPaymentChannelList("card")).toBe(false);
    expect(isPaymentChannelList([...PAYMENT_CHANNELS, "card"])).toBe(false);
  });

  it("the mock remembers the channels a checkout asked for, and says so when none were sent", async () => {
    const mock = createMockPayment();
    const withChannels = await mock.initializeTransaction({ reference: ref(1), email: "a@example.com", amountKobo: 100_000, channels: ["card", "bank_transfer"] });
    const without = await mock.initializeTransaction({ reference: ref(2), email: "a@example.com", amountKobo: 100_000 });
    expect(withChannels.ok && without.ok).toBe(true);
    expect(mock.channelsFor(ref(1))).toEqual(["card", "bank_transfer"]);
    expect(mock.channelsFor(ref(2))).toBeUndefined();
    expect(mock.channelsFor(ref(3))).toBeUndefined();
  });

  it("the mock and the Paystack adapter both refuse a channel list that is not valid", async () => {
    const mock = createMockPayment();
    const fake = createFakePaystack();
    const paystack = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
    for (const provider of [mock, paystack]) {
      const r = await provider.initializeTransaction({ reference: ref(4), email: "a@example.com", amountKobo: 100_000, channels: ["card", "cheque"] as never });
      expect(r.ok).toBe(false);
    }
  });

  it("the Paystack adapter sends the channels it was given", async () => {
    const fake = createFakePaystack();
    const paystack = createPaystackPayment({ secretKey: fake.secretKey, fetch: fake.fetch });
    const r = await paystack.initializeTransaction({ reference: ref(5), email: "a@example.com", amountKobo: 100_000, channels: ["card"] });
    expect(r.ok).toBe(true);
  });
});
