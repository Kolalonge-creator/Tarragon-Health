import type { ProviderResult } from "./result.ts";

/**
 * Payments (spec section 10). Paystack is the only live provider. The interface is deliberately narrow:
 * - Money is integer kobo (INV-15) and the currency is NGN only. Amounts are checked on the way in.
 * - There is no balance, wallet or top-up method (INV-09): every payment is a checkout for one specific item,
 *   and `paymentMatchesOrder` is the check a "paid" decision must pass after the vendor has confirmed it.
 * - A browser callback is never proof of payment. Mark an order paid only after a signed webhook AND `verifyTransaction`.
 */
export type Kobo = number;
export type PaymentMetadata = Readonly<Record<string, string | number | boolean>>;

export interface InitializeTransactionInput {
  /** Our own unique reference for this checkout (one per order attempt). */
  readonly reference: string;
  readonly email: string;
  readonly amountKobo: Kobo;
  readonly callbackUrl?: string;
  /** Opaque ids only (order id). Never a condition, reading or result: Paystack shows metadata in its dashboard. */
  readonly metadata?: PaymentMetadata;
}
export interface InitializedTransaction {
  readonly reference: string;
  readonly authorizationUrl: string;
  readonly accessCode: string;
}

export type TransactionStatus = "success" | "failed" | "abandoned" | "pending" | "reversed";
export interface VerifiedTransaction {
  readonly reference: string;
  readonly status: TransactionStatus;
  /** What the customer was charged in total. With fee pass-through on, this is the price PLUS the processing fee. */
  readonly amountKobo: Kobo;
  /** The price we asked for (the order amount). Equals `amountKobo` when we bear the fee. */
  readonly requestedAmountKobo: Kobo;
  /** The processor's fee on this payment, in kobo. */
  readonly feesKobo: Kobo;
  readonly currency: string;
  readonly paidAt: string | null;
  readonly customerEmail: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface RefundInput {
  /** The reference of the original charge. */
  readonly reference: string;
  /** Omit for a full refund. */
  readonly amountKobo?: Kobo;
  readonly reason?: string;
}
export type RefundStatus = "pending" | "processing" | "processed" | "failed" | "needs_attention";
export interface RefundReceipt {
  readonly refundId: string;
  readonly status: RefundStatus;
}

export interface Bank {
  readonly code: string;
  readonly name: string;
}
export interface ResolvedAccount {
  readonly accountNumber: string;
  readonly accountName: string;
}
export interface TransferRecipientInput {
  readonly name: string;
  readonly accountNumber: string;
  readonly bankCode: string;
}
export interface TransferRecipient {
  readonly recipientCode: string;
}
export interface InitiateTransferInput {
  /** Caller-chosen, unique, lower case: this is the idempotency key for the payout line. */
  readonly reference: string;
  readonly amountKobo: Kobo;
  readonly recipientCode: string;
  readonly reason?: string;
}
export type TransferStatus = "pending" | "success" | "failed" | "reversed" | "needs_attention";
export interface TransferReceipt {
  readonly transferCode: string;
  readonly reference: string;
  readonly status: TransferStatus;
  readonly amountKobo: Kobo;
}

/** A webhook after the signature check, in our terms. `key` is stable across redeliveries (the idempotency key). */
export type PaymentEvent =
  | {
      readonly kind: "charge_success";
      readonly key: string;
      readonly reference: string;
      readonly amountKobo: Kobo;
      readonly currency: string;
      readonly paidAt: string | null;
      readonly customerEmail: string | null;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: "refund"; readonly key: string; readonly reference: string; readonly status: RefundStatus }
  | { readonly kind: "transfer"; readonly key: string; readonly reference: string; readonly transferCode: string | null; readonly status: TransferStatus }
  | { readonly kind: "unknown"; readonly key: string; readonly eventType: string };

export interface PaymentProvider {
  readonly name: "paystack" | "mock";
  /** True for the in-memory mock. `selectProvider` refuses a mock in production. */
  readonly isMock: boolean;
  initializeTransaction(input: InitializeTransactionInput): Promise<ProviderResult<InitializedTransaction>>;
  verifyTransaction(reference: string): Promise<ProviderResult<VerifiedTransaction>>;
  refund(input: RefundInput): Promise<ProviderResult<RefundReceipt>>;
  listBanks(): Promise<ProviderResult<readonly Bank[]>>;
  resolveAccount(input: { accountNumber: string; bankCode: string }): Promise<ProviderResult<ResolvedAccount>>;
  createTransferRecipient(input: TransferRecipientInput): Promise<ProviderResult<TransferRecipient>>;
  initiateTransfer(input: InitiateTransferInput): Promise<ProviderResult<TransferReceipt>>;
  verifyTransfer(reference: string): Promise<ProviderResult<TransferReceipt>>;
  /** Checks the signature on the RAW body, then normalises. A bad signature is `invalid_signature`; the body is not parsed. */
  parseWebhook(rawBody: string, signatureHeader: string | null): Promise<ProviderResult<PaymentEvent>>;
}

// ---- input rules shared by every implementation, so the mock refuses what the real adapter would ----

/** Whole naira-sized-or-bigger positive integers of kobo only; a fraction of a kobo or a negative sum is never a price. */
export const MAX_KOBO = 100_000_000_000; // 1 billion naira, a sanity bound, not a business limit

export const isValidKobo = (n: unknown): n is Kobo => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= MAX_KOBO;

/** Paystack: letters, digits, dash, dot, equals; long enough to be unique. */
export const isValidChargeReference = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9._=-]{8,100}$/.test(s);

/** Paystack transfer references: lower case letters, digits, dash, underscore, 16 to 50 characters. */
export const isValidTransferReference = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9_-]{16,50}$/.test(s);

export const isValidEmail = (s: unknown): s is string => typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export const isValidAccountNumber = (s: unknown): s is string => typeof s === "string" && /^\d{10}$/.test(s);
export const isValidBankCode = (s: unknown): s is string => typeof s === "string" && /^\d{3,6}$/.test(s);

/**
 * The check a "paid" decision must pass after `verifyTransaction`: the vendor says success, for exactly the PRICE,
 * currency and reference of OUR order. Underpayment and a reference swap both fail here. The processing fee is separate:
 * when it is passed to the patient they pay price + fee, and `customerFeeKobo` is that extra, which must be shown to them
 * before they pay and may never exceed the fee the processor actually took.
 */
export function paymentMatchesOrder(
  verified: VerifiedTransaction,
  expected: { readonly reference: string; readonly amountKobo: Kobo; readonly currency?: string },
):
  | { readonly ok: true; readonly customerFeeKobo: Kobo }
  | { readonly ok: false; readonly reason: "not_paid" | "reference" | "amount" | "currency" | "fee" } {
  if (verified.status !== "success") return { ok: false, reason: "not_paid" };
  if (verified.reference !== expected.reference) return { ok: false, reason: "reference" };
  if (verified.currency !== (expected.currency ?? "NGN")) return { ok: false, reason: "currency" };
  if (verified.requestedAmountKobo !== expected.amountKobo) return { ok: false, reason: "amount" };
  const customerFeeKobo = verified.amountKobo - verified.requestedAmountKobo;
  if (customerFeeKobo < 0 || customerFeeKobo > verified.feesKobo) return { ok: false, reason: "fee" };
  return { ok: true, customerFeeKobo };
}
