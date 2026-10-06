import { constantTimeEqual, hmacHex } from "./crypto.ts";
import {
  isValidAccountNumber,
  isValidBankCode,
  isValidChargeReference,
  isValidEmail,
  isValidKobo,
  isValidTransferReference,
  type PaymentProvider,
  type TransactionStatus,
  type TransferReceipt,
  type TransferStatus,
  type VerifiedTransaction,
} from "./payment.ts";
import { parsePaystackWebhookBody } from "./payment-paystack.ts";
import { fail, ok } from "./result.ts";

/**
 * In-memory payment provider for tests and for development without a Paystack key. It enforces the same input
 * rules as the real adapter and can be driven to any outcome. It must never run in production: `isMock` is true and
 * `selectProvider` refuses it there.
 */
export interface MockPaymentControl {
  /** Moves a transaction to a final state, as the customer finishing (or abandoning) checkout would. */
  settle(reference: string, status: Exclude<TransactionStatus, "pending">): void;
  settleTransfer(reference: string, status: Exclude<TransferStatus, "pending">): void;
  /** A signed webhook body for a charge, as Paystack would send it. */
  signedChargeWebhook(reference: string): Promise<{ rawBody: string; signature: string }>;
  signedWebhook(body: unknown): Promise<{ rawBody: string; signature: string }>;
  signedRaw(rawBody: string): Promise<{ rawBody: string; signature: string }>;
  /** The processor's fee, passed on to the customer, as Paystack does when fee pass-through is on. Set before settling. */
  setCustomerFee(reference: string, feeKobo: number): void;
  /** Makes the next call of any kind fail the way a dropped connection does. */
  failNextCall(): void;
  readonly secret: string;
}

interface Charge {
  reference: string;
  email: string;
  amountKobo: number;
  feeKobo: number;
  status: TransactionStatus;
  paidAt: string | null;
  metadata: Record<string, unknown>;
}

export function createMockPayment(now: () => number = () => Date.now()): PaymentProvider & MockPaymentControl {
  const secret = "mock-webhook-secret";
  const charges = new Map<string, Charge>();
  const refunded = new Map<string, number>();
  const transfers = new Map<string, TransferReceipt>();
  const recipients = new Set<string>();
  let failNext = false;
  let seq = 0;

  const dropped = () => {
    if (!failNext) return null;
    failNext = false;
    return fail("network", "Could not reach the vendor");
  };

  const sign = async (body: unknown) => {
    const rawBody = JSON.stringify(body);
    return { rawBody, signature: await hmacHex("SHA-512", secret, rawBody) };
  };

  return {
    name: "mock",
    isMock: true,
    secret,

    settle(reference, status) {
      const c = charges.get(reference);
      if (!c) throw new Error("unknown reference");
      c.status = status;
      c.paidAt = status === "success" ? new Date(now()).toISOString() : null;
    },
    setCustomerFee(reference, feeKobo) {
      const c = charges.get(reference);
      if (!c) throw new Error("unknown reference");
      c.feeKobo = feeKobo;
    },
    settleTransfer(reference, status) {
      const t = transfers.get(reference);
      if (!t) throw new Error("unknown reference");
      transfers.set(reference, { ...t, status });
    },
    signedChargeWebhook(reference) {
      const c = charges.get(reference);
      if (!c) throw new Error("unknown reference");
      return sign({
        event: "charge.success",
        data: { reference, amount: c.amountKobo + c.feeKobo, currency: "NGN", paid_at: c.paidAt, customer: { email: c.email }, metadata: c.metadata },
      });
    },
    signedWebhook: sign,
    async signedRaw(rawBody) {
      return { rawBody, signature: await hmacHex("SHA-512", secret, rawBody) };
    },
    failNextCall() {
      failNext = true;
    },

    async initializeTransaction(input) {
      const d = dropped();
      if (d) return d;
      if (!isValidChargeReference(input.reference)) return fail("invalid_input", "Reference is not a valid charge reference");
      if (!isValidEmail(input.email)) return fail("invalid_input", "Email is not valid");
      if (!isValidKobo(input.amountKobo)) return fail("invalid_input", "Amount must be a positive whole number of kobo");
      if (charges.has(input.reference)) return fail("conflict", "Reference already used", false);
      charges.set(input.reference, {
        reference: input.reference,
        email: input.email,
        amountKobo: input.amountKobo,
        feeKobo: 0,
        status: "pending",
        paidAt: null,
        metadata: { ...(input.metadata ?? {}) },
      });
      return ok({ reference: input.reference, authorizationUrl: `https://checkout.mock.invalid/${input.reference}`, accessCode: `mock_${input.reference}` });
    },

    async verifyTransaction(reference) {
      const d = dropped();
      if (d) return d;
      if (!isValidChargeReference(reference)) return fail("invalid_input", "Reference is not a valid charge reference");
      const c = charges.get(reference);
      if (!c) return fail("not_found", "No such transaction", false);
      const v: VerifiedTransaction = {
        reference: c.reference,
        status: c.status,
        amountKobo: c.amountKobo + c.feeKobo,
        requestedAmountKobo: c.amountKobo,
        feesKobo: c.feeKobo,
        currency: "NGN",
        paidAt: c.paidAt,
        customerEmail: c.email,
        metadata: c.metadata,
      };
      return ok(v);
    },

    async refund(input) {
      const d = dropped();
      if (d) return d;
      if (!isValidChargeReference(input.reference)) return fail("invalid_input", "Reference is not a valid charge reference");
      if (input.amountKobo !== undefined && !isValidKobo(input.amountKobo)) return fail("invalid_input", "Amount must be a positive whole number of kobo");
      const c = charges.get(input.reference);
      if (!c) return fail("not_found", "No such transaction", false);
      if (c.status !== "success") return fail("conflict", "Only a paid transaction can be refunded", false);
      const already = refunded.get(input.reference) ?? 0;
      const amount = input.amountKobo ?? c.amountKobo - already;
      if (amount <= 0 || already + amount > c.amountKobo) return fail("conflict", "Refund is more than was paid", false);
      refunded.set(input.reference, already + amount);
      seq += 1;
      return ok({ refundId: String(1000 + seq), status: "pending" as const });
    },

    async listBanks() {
      const d = dropped();
      if (d) return d;
      return ok([
        { code: "044", name: "Access Bank" },
        { code: "058", name: "Guaranty Trust Bank" },
      ]);
    },

    async resolveAccount(input) {
      const d = dropped();
      if (d) return d;
      if (!isValidAccountNumber(input.accountNumber)) return fail("invalid_input", "Account number must be 10 digits");
      if (!isValidBankCode(input.bankCode)) return fail("invalid_input", "Bank code is not valid");
      // Ten zeros is the one account that does not exist, so tests can reach the not-found path.
      if (input.accountNumber === "0000000000") return fail("not_found", "Could not resolve account", false);
      return ok({ accountNumber: input.accountNumber, accountName: "TEST ACCOUNT HOLDER" });
    },

    async createTransferRecipient(input) {
      const d = dropped();
      if (d) return d;
      if (!isValidAccountNumber(input.accountNumber)) return fail("invalid_input", "Account number must be 10 digits");
      if (!isValidBankCode(input.bankCode)) return fail("invalid_input", "Bank code is not valid");
      if (input.name.trim().length === 0) return fail("invalid_input", "Name is required");
      const code = `RCP_mock_${input.bankCode}_${input.accountNumber}`;
      recipients.add(code);
      return ok({ recipientCode: code });
    },

    async initiateTransfer(input) {
      const d = dropped();
      if (d) return d;
      if (!isValidTransferReference(input.reference)) return fail("invalid_input", "Reference is not a valid transfer reference");
      if (!isValidKobo(input.amountKobo)) return fail("invalid_input", "Amount must be a positive whole number of kobo");
      if (!recipients.has(input.recipientCode)) return fail("not_found", "No such recipient", false);
      if (transfers.has(input.reference)) return fail("conflict", "Reference already used", false);
      seq += 1;
      const receipt: TransferReceipt = { transferCode: `TRF_mock_${seq}`, reference: input.reference, status: "pending", amountKobo: input.amountKobo };
      transfers.set(input.reference, receipt);
      return ok(receipt);
    },

    async verifyTransfer(reference) {
      const d = dropped();
      if (d) return d;
      if (!isValidTransferReference(reference)) return fail("invalid_input", "Reference is not a valid transfer reference");
      const t = transfers.get(reference);
      return t ? ok(t) : fail("not_found", "No such transfer", false);
    },

    async parseWebhook(rawBody, signatureHeader) {
      if (!signatureHeader) return fail("invalid_signature", "Signature is missing", false);
      const expected = await hmacHex("SHA-512", secret, rawBody);
      if (!constantTimeEqual(signatureHeader.toLowerCase(), expected)) return fail("invalid_signature", "Signature does not match", false);
      return parsePaystackWebhookBody(rawBody);
    },
  };
}
