import { describe, expect, it } from "@jest/globals";
import { paymentMatchesOrder, type PaymentProvider } from "../../../../supabase/functions/_shared/integrations/index.ts";

/**
 * One contract for every PaymentProvider: the in-memory mock, the Paystack adapter over a fake vendor, and (S25, S31)
 * the Paystack adapter against Paystack's test mode. A fixture that cannot move money (a live test key) leaves
 * `settle` out and the scenarios that need a paid transaction are skipped.
 */
export interface PaymentFixture {
  readonly provider: PaymentProvider;
  setCustomerFee?(reference: string, feeKobo: number): void;
  settle?(reference: string, status: "success" | "failed" | "abandoned"): void;
  settleTransfer?(reference: string, status: "success" | "failed" | "reversed"): void;
  signedWebhook(body: unknown): Promise<{ rawBody: string; signature: string }>;
  signedRaw(rawBody: string): Promise<{ rawBody: string; signature: string }>;
  failNextCall?(): void;
}

let counter = 0;
const uniq = (prefix: string, max = 40): string => `${prefix}${Date.now().toString(36)}${(counter += 1).toString(36)}`.slice(0, max);
const chargeRef = (): string => uniq("chg-", 60);
const transferRef = (): string => uniq("trf_contract_", 40).toLowerCase();

export function runPaymentContract(name: string, make: () => PaymentFixture): void {
  const probe = make();
  const canSettle = probe.settle !== undefined;
  const canFail = probe.failNextCall !== undefined;
  const paid = canSettle ? it : it.skip;
  const dropped = canFail ? it : it.skip;

  describe(`PaymentProvider contract: ${name}`, () => {
    it("has no wallet, balance or top-up surface (INV-09)", () => {
      const f = make();
      const names = Object.keys(f.provider);
      expect(names.filter((n) => /balance|wallet|top.?up|credit|^fund|deposit/i.test(n))).toEqual([]);
    });

    it("refuses an amount that is not a positive whole number of kobo (INV-15)", async () => {
      const f = make();
      for (const amountKobo of [0, -500, 100.5, Number.NaN, Number.POSITIVE_INFINITY, 1e15]) {
        const r = await f.provider.initializeTransaction({ reference: chargeRef(), email: "a@example.com", amountKobo });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_input");
      }
    });

    it("refuses a bad email and a bad reference", async () => {
      const f = make();
      const badEmail = await f.provider.initializeTransaction({ reference: chargeRef(), email: "not-an-email", amountKobo: 100_000 });
      const badRef = await f.provider.initializeTransaction({ reference: "short", email: "a@example.com", amountKobo: 100_000 });
      expect([badEmail.ok, badRef.ok]).toEqual([false, false]);
    });

    it("initialises a checkout, then verifies it as pending for the same amount in NGN", async () => {
      const f = make();
      const reference = chargeRef();
      const init = await f.provider.initializeTransaction({ reference, email: "a@example.com", amountKobo: 777_000, metadata: { order_id: "o-1" } });
      expect(init.ok).toBe(true);
      if (!init.ok) return;
      expect(init.data.reference).toBe(reference);
      expect(init.data.authorizationUrl).toMatch(/^https:\/\//);
      const v = await f.provider.verifyTransaction(reference);
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.data).toMatchObject({ reference, amountKobo: 777_000, currency: "NGN" });
      expect(["pending", "abandoned"]).toContain(v.data.status);
      expect(paymentMatchesOrder(v.data, { reference, amountKobo: 777_000 })).toEqual({ ok: false, reason: "not_paid" });
    });

    it("does not accept the same reference twice", async () => {
      const f = make();
      const reference = chargeRef();
      expect((await f.provider.initializeTransaction({ reference, email: "a@example.com", amountKobo: 50_000 })).ok).toBe(true);
      const again = await f.provider.initializeTransaction({ reference, email: "a@example.com", amountKobo: 50_000 });
      expect(again.ok).toBe(false);
      // A retry after a timeout must be able to tell "already went through" from a real rejection.
      if (!again.ok) expect(again.error).toMatchObject({ code: "conflict", retryable: false });
    });

    it("says not found for a reference it has never seen", async () => {
      const r = await make().provider.verifyTransaction(chargeRef());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("not_found");
    });

    paid("treats a paid transaction as paid only when amount, currency and reference all match our order", async () => {
      const f = make();
      const reference = chargeRef();
      await f.provider.initializeTransaction({ reference, email: "a@example.com", amountKobo: 250_000 });
      f.settle!(reference, "success");
      const v = await f.provider.verifyTransaction(reference);
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.data.status).toBe("success");
      expect(paymentMatchesOrder(v.data, { reference, amountKobo: 250_000 })).toEqual({ ok: true, customerFeeKobo: 0 });
      expect(paymentMatchesOrder(v.data, { reference, amountKobo: 300_000 })).toEqual({ ok: false, reason: "amount" });
      expect(paymentMatchesOrder(v.data, { reference: "other-reference", amountKobo: 250_000 })).toEqual({ ok: false, reason: "reference" });
      expect(paymentMatchesOrder(v.data, { reference, amountKobo: 250_000, currency: "USD" })).toEqual({ ok: false, reason: "currency" });
    });

    paid("keeps the price and the processing fee apart when the fee is passed to the patient", async () => {
      const f = make();
      const reference = chargeRef();
      await f.provider.initializeTransaction({ reference, email: "a@example.com", amountKobo: 250_000 });
      f.setCustomerFee!(reference, 11_250);
      f.settle!(reference, "success");
      const v = await f.provider.verifyTransaction(reference);
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.data).toMatchObject({ amountKobo: 261_250, requestedAmountKobo: 250_000, feesKobo: 11_250 });
      // The order is matched on the price; the fee is reported so it can be shown and recorded.
      expect(paymentMatchesOrder(v.data, { reference, amountKobo: 250_000 })).toEqual({ ok: true, customerFeeKobo: 11_250 });
      expect(paymentMatchesOrder(v.data, { reference, amountKobo: 261_250 })).toEqual({ ok: false, reason: "amount" });
    });

    paid("does not treat a failed or abandoned checkout as paid", async () => {
      const f = make();
      const reference = chargeRef();
      await f.provider.initializeTransaction({ reference, email: "a@example.com", amountKobo: 250_000 });
      f.settle!(reference, "failed");
      const v = await f.provider.verifyTransaction(reference);
      expect(v.ok && paymentMatchesOrder(v.data, { reference, amountKobo: 250_000 }).ok).toBe(false);
    });

    paid("refunds only a paid transaction, and never more than was paid", async () => {
      const f = make();
      const unpaid = chargeRef();
      await f.provider.initializeTransaction({ reference: unpaid, email: "a@example.com", amountKobo: 100_000 });
      expect((await f.provider.refund({ reference: unpaid })).ok).toBe(false);

      const reference = chargeRef();
      await f.provider.initializeTransaction({ reference, email: "a@example.com", amountKobo: 100_000 });
      f.settle!(reference, "success");
      const part = await f.provider.refund({ reference, amountKobo: 40_000 });
      expect(part.ok).toBe(true);
      if (part.ok) expect(part.data.refundId.length).toBeGreaterThan(0);
      expect((await f.provider.refund({ reference, amountKobo: 70_000 })).ok).toBe(false);
      expect((await f.provider.refund({ reference, amountKobo: 60_000 })).ok).toBe(true);
      expect((await f.provider.refund({ reference, amountKobo: 1 })).ok).toBe(false);
    });

    it("refuses a refund amount that is not whole kobo", async () => {
      const r = await make().provider.refund({ reference: chargeRef(), amountKobo: 10.5 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    });

    it("accepts a correctly signed charge webhook and gives the same idempotency key on a redelivery", async () => {
      const f = make();
      const reference = chargeRef();
      const hook = await f.signedWebhook({
        event: "charge.success",
        data: { reference, amount: 777_000, currency: "NGN", paid_at: "2026-10-06T10:00:00.000Z", customer: { email: "a@example.com" }, metadata: { order_id: "o-1" } },
      });
      const first = await f.provider.parseWebhook(hook.rawBody, hook.signature);
      const second = await f.provider.parseWebhook(hook.rawBody, hook.signature);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(first.data).toMatchObject({ kind: "charge_success", reference, amountKobo: 777_000, currency: "NGN" });
      expect(first.data.key).toBe(second.data.key);
    });

    it("rejects a webhook with a missing, wrong or tampered signature, without reading the body", async () => {
      const f = make();
      const hook = await f.signedWebhook({ event: "charge.success", data: { reference: chargeRef(), amount: 100_000, currency: "NGN" } });
      for (const sig of [null, "", "deadbeef", hook.signature.replace(/.$/, (c) => (c === "0" ? "1" : "0"))]) {
        const r = await f.provider.parseWebhook(hook.rawBody, sig);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_signature");
      }
      const tampered = await f.provider.parseWebhook(hook.rawBody.replace("100000", "1"), hook.signature);
      expect(tampered.ok).toBe(false);
    });

    it("normalises event types it does not act on as unknown, and never throws on a signed non-JSON body", async () => {
      const f = make();
      const unknown = await f.signedWebhook({ event: "customeridentification.success", data: { reference: chargeRef() } });
      const r = await f.provider.parseWebhook(unknown.rawBody, unknown.signature);
      expect(r.ok && r.data.kind).toBe("unknown");
      const garbage = await f.signedRaw("this is not json");
      const g = await f.provider.parseWebhook(garbage.rawBody, garbage.signature);
      expect(g.ok).toBe(false);
      if (!g.ok) expect(g.error.code).not.toBe("invalid_signature");
    });

    it("normalises refund and transfer webhooks the same way for every implementation", async () => {
      const f = make();
      const reference = chargeRef();
      const refund = await f.signedWebhook({ event: "refund.processed", data: { status: "processed", transaction_reference: reference, refund_reference: "rr_1", amount: 100 } });
      const r = await f.provider.parseWebhook(refund.rawBody, refund.signature);
      expect(r.ok && r.data).toMatchObject({ kind: "refund", reference, status: "processed" });
      const tref = transferRef();
      for (const status of ["success", "failed", "reversed"] as const) {
        const hook = await f.signedWebhook({ event: `transfer.${status}`, data: { reference: tref, transfer_code: "TRF_1", status } });
        const t = await f.provider.parseWebhook(hook.rawBody, hook.signature);
        expect(t.ok && t.data).toMatchObject({ kind: "transfer", reference: tref, status });
      }
    });

    it("lists banks and resolves an account, refusing a malformed account number", async () => {
      const f = make();
      const banks = await f.provider.listBanks();
      expect(banks.ok && banks.data.length > 0).toBe(true);
      if (banks.ok) expect(banks.data.every((b) => b.code.length > 0 && b.name.length > 0)).toBe(true);
      const bad = await f.provider.resolveAccount({ accountNumber: "123", bankCode: "044" });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe("invalid_input");
      const missing = await f.provider.resolveAccount({ accountNumber: "0000000000", bankCode: "044" });
      expect(missing.ok).toBe(false);
    });

    paid("resolves a valid account to the name on it", async () => {
      const r = await make().provider.resolveAccount({ accountNumber: "0123456789", bankCode: "044" });
      expect(r.ok && r.data).toMatchObject({ accountNumber: "0123456789" });
      if (r.ok) expect(r.data.accountName.length).toBeGreaterThan(0);
    });

    paid("pays a clinician in kobo: recipient, transfer, verify, and never the same reference twice", async () => {
      const f = make();
      const recipient = await f.provider.createTransferRecipient({ name: "Test Clinician", accountNumber: "0123456789", bankCode: "044" });
      expect(recipient.ok).toBe(true);
      if (!recipient.ok) return;
      const reference = transferRef();
      const t = await f.provider.initiateTransfer({ reference, amountKobo: 4_500_000, recipientCode: recipient.data.recipientCode, reason: "Weekly statement" });
      expect(t.ok).toBe(true);
      if (!t.ok) return;
      expect(t.data).toMatchObject({ reference, amountKobo: 4_500_000, status: "pending" });
      const again = await f.provider.initiateTransfer({ reference, amountKobo: 4_500_000, recipientCode: recipient.data.recipientCode });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.code).toBe("conflict");
      f.settleTransfer?.(reference, "success");
      const v = await f.provider.verifyTransfer(reference);
      expect(v.ok && v.data.status).toBe(f.settleTransfer ? "success" : "pending");
    });

    it("refuses a transfer with a bad reference or a non-kobo amount", async () => {
      const f = make();
      const badRef = await f.provider.initiateTransfer({ reference: "Has Spaces", amountKobo: 1000, recipientCode: "RCP_x" });
      const badAmount = await f.provider.initiateTransfer({ reference: transferRef(), amountKobo: 10.5, recipientCode: "RCP_x" });
      expect(badRef.ok).toBe(false);
      expect(badAmount.ok).toBe(false);
      if (!badRef.ok) expect(badRef.error.code).toBe("invalid_input");
      if (!badAmount.ok) expect(badAmount.error.code).toBe("invalid_input");
    });

    dropped("returns a retryable failure, not an exception, when the vendor cannot be reached", async () => {
      const f = make();
      f.failNextCall!();
      const r = await f.provider.initializeTransaction({ reference: chargeRef(), email: "a@example.com", amountKobo: 100_000 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: "network", retryable: true });
      // The next call works again.
      expect((await f.provider.initializeTransaction({ reference: chargeRef(), email: "a@example.com", amountKobo: 100_000 })).ok).toBe(true);
    });
  });
}
