import { constantTimeEqual, hmacHex } from "./crypto.ts";
import { asObject, httpJson, type FetchLike } from "./http.ts";
import {
  isValidAccountNumber,
  isValidBankCode,
  isValidChargeReference,
  isValidEmail,
  isValidKobo,
  isValidTransferReference,
  type PaymentEvent,
  type PaymentProvider,
  type RefundStatus,
  type TransactionStatus,
  type TransferReceipt,
  type TransferStatus,
} from "./payment.ts";
import { fail, ok, type ProviderResult } from "./result.ts";

/**
 * Paystack adapter (skeleton, S14). Endpoints and field names follow Paystack's published API reference; none of it
 * has run against a live account yet, so S25 (checkout) and S31 (transfers) re-check each call in Paystack's test
 * mode before relying on it. The live subscription and booking paths in `apps/web/src/lib/paystack` are untouched.
 */
export interface PaystackConfig {
  readonly secretKey: string;
  /** Paystack signs webhooks with the secret key itself; pass `PAYSTACK_WEBHOOK_SECRET` only if it is set to something else. */
  readonly webhookSecret?: string;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_BASE_URL = "https://api.paystack.co";
const DUPLICATE = /duplicate|already (used|exists)/i;
const MAX_BANK_PAGES = 10;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const bad = (what: string) => fail("bad_response", `Paystack sent an unexpected ${what}`);

const TXN_STATUS: Readonly<Record<string, TransactionStatus>> = {
  success: "success",
  failed: "failed",
  abandoned: "abandoned",
  reversed: "reversed",
};
const REFUND_STATUS: Readonly<Record<string, RefundStatus>> = {
  pending: "pending",
  processing: "processing",
  processed: "processed",
  failed: "failed",
  "needs-attention": "needs_attention",
};
const TRANSFER_STATUS: Readonly<Record<string, TransferStatus>> = {
  success: "success",
  failed: "failed",
  reversed: "reversed",
  pending: "pending",
  received: "pending",
  // An OTP is waiting on Paystack's side. We want OTP-free transfers, so a human has to look at it.
  otp: "needs_attention",
};

const toTransactionStatus = (s: string | null): TransactionStatus => (s !== null ? TXN_STATUS[s] : undefined) ?? "pending";
const toRefundStatus = (s: string | null): RefundStatus => (s !== null ? REFUND_STATUS[s] : undefined) ?? "pending";
const toTransferStatus = (s: string | null): TransferStatus => (s !== null ? TRANSFER_STATUS[s] : undefined) ?? "needs_attention";

export function createPaystackPayment(config: PaystackConfig): PaymentProvider {
  const base = config.baseUrl ?? DEFAULT_BASE_URL;
  const deps = { fetch: config.fetch, timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const headers = { Authorization: `Bearer ${config.secretKey}` };
  const webhookSecret = config.webhookSecret ?? config.secretKey;

  /** Calls Paystack and unwraps `{ status, message, data, meta }`. */
  async function callWithMeta(method: "GET" | "POST", path: string, body?: unknown): Promise<ProviderResult<{ data: unknown; meta: Record<string, unknown> | null }>> {
    const res = await httpJson(deps, { url: `${base}${path}`, method, headers, body });
    if (!res.ok) {
      // Paystack answers a reused reference with a plain 400. Say so: a retry after a timeout must be able to tell
      // "my earlier attempt went through, verify it" from a real rejection.
      return res.error.code === "vendor_error" && DUPLICATE.test(res.error.message) ? fail("conflict", res.error.message, false) : res;
    }
    const env = asObject(res.data);
    if (!env) return bad("reply");
    if (env["status"] !== true) return fail("vendor_error", str(env["message"]) ?? "Paystack reported an error", false);
    return ok({ data: env["data"], meta: asObject(env["meta"]) });
  }

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<ProviderResult<unknown>> {
    const res = await callWithMeta(method, path, body);
    return res.ok ? ok(res.data.data) : res;
  }

  function readTransfer(data: unknown): ProviderResult<TransferReceipt> {
    const d = asObject(data);
    const amountKobo = int(d?.["amount"]);
    const reference = str(d?.["reference"]);
    const transferCode = str(d?.["transfer_code"]);
    if (!d || amountKobo === null || !reference || !transferCode) return bad("transfer");
    return ok({ transferCode, reference, amountKobo, status: toTransferStatus(str(d["status"])) });
  }

  return {
    name: "paystack",
    isMock: false,

    async initializeTransaction(input) {
      if (!isValidChargeReference(input.reference)) return fail("invalid_input", "Reference is not a valid charge reference");
      if (!isValidEmail(input.email)) return fail("invalid_input", "Email is not valid");
      if (!isValidKobo(input.amountKobo)) return fail("invalid_input", "Amount must be a positive whole number of kobo");
      const res = await call("POST", "/transaction/initialize", {
        reference: input.reference,
        email: input.email,
        amount: input.amountKobo,
        currency: "NGN",
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      });
      if (!res.ok) return res;
      const d = asObject(res.data);
      const authorizationUrl = str(d?.["authorization_url"]);
      const accessCode = str(d?.["access_code"]);
      const reference = str(d?.["reference"]);
      if (!authorizationUrl || !accessCode || !reference) return bad("checkout");
      return ok({ reference, authorizationUrl, accessCode });
    },

    async verifyTransaction(reference) {
      if (!isValidChargeReference(reference)) return fail("invalid_input", "Reference is not a valid charge reference");
      const res = await call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
      if (!res.ok) return res;
      const d = asObject(res.data);
      const amountKobo = int(d?.["amount"]);
      const ref = str(d?.["reference"]);
      const currency = str(d?.["currency"]);
      if (!d || amountKobo === null || !ref || !currency) return bad("transaction");
      return ok({
        reference: ref,
        status: toTransactionStatus(str(d["status"])),
        amountKobo,
        // Paystack reports the price we asked for and its fee separately; without them the whole amount is the price.
        requestedAmountKobo: int(d["requested_amount"]) ?? amountKobo,
        feesKobo: int(d["fees"]) ?? 0,
        currency,
        paidAt: str(d["paid_at"]),
        customerEmail: str(asObject(d["customer"])?.["email"]),
        metadata: asObject(d["metadata"]) ?? {},
      });
    },

    async refund(input) {
      if (!isValidChargeReference(input.reference)) return fail("invalid_input", "Reference is not a valid charge reference");
      if (input.amountKobo !== undefined && !isValidKobo(input.amountKobo)) return fail("invalid_input", "Amount must be a positive whole number of kobo");
      const res = await call("POST", "/refund", {
        transaction: input.reference,
        amount: input.amountKobo,
        merchant_note: input.reason,
      });
      if (!res.ok) return res;
      const d = asObject(res.data);
      const id = d?.["id"];
      const refundId = typeof id === "number" || typeof id === "string" ? String(id) : null;
      if (!d || !refundId) return bad("refund");
      return ok({ refundId, status: toRefundStatus(str(d["status"])) });
    },

    async listBanks() {
      const banks: { code: string; name: string }[] = [];
      let cursor: string | null = null;
      // Paystack pages this list by cursor; one page is not the whole list.
      for (let page = 0; page < MAX_BANK_PAGES; page++) {
        const res: ProviderResult<{ data: unknown; meta: Record<string, unknown> | null }> = await callWithMeta(
          "GET",
          `/bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100${cursor ? `&next=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (!res.ok) return res;
        if (!Array.isArray(res.data.data)) return bad("bank list");
        for (const row of res.data.data) {
          const code = str(asObject(row)?.["code"]);
          const name = str(asObject(row)?.["name"]);
          if (code && name) banks.push({ code, name });
        }
        cursor = str(res.data.meta?.["next"]);
        if (!cursor) return ok(banks);
      }
      return fail("bad_response", "Paystack bank list did not end", false);
    },

    async resolveAccount(input) {
      if (!isValidAccountNumber(input.accountNumber)) return fail("invalid_input", "Account number must be 10 digits");
      if (!isValidBankCode(input.bankCode)) return fail("invalid_input", "Bank code is not valid");
      const res = await call("GET", `/bank/resolve?account_number=${input.accountNumber}&bank_code=${input.bankCode}`);
      if (!res.ok) return res;
      const accountName = str(asObject(res.data)?.["account_name"]);
      if (!accountName) return bad("account");
      return ok({ accountNumber: input.accountNumber, accountName });
    },

    async createTransferRecipient(input) {
      if (!isValidAccountNumber(input.accountNumber)) return fail("invalid_input", "Account number must be 10 digits");
      if (!isValidBankCode(input.bankCode)) return fail("invalid_input", "Bank code is not valid");
      if (input.name.trim().length === 0) return fail("invalid_input", "Name is required");
      const res = await call("POST", "/transferrecipient", {
        type: "nuban",
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: "NGN",
      });
      if (!res.ok) return res;
      const recipientCode = str(asObject(res.data)?.["recipient_code"]);
      if (!recipientCode) return bad("recipient");
      return ok({ recipientCode });
    },

    async initiateTransfer(input) {
      if (!isValidTransferReference(input.reference)) return fail("invalid_input", "Reference is not a valid transfer reference");
      if (!isValidKobo(input.amountKobo)) return fail("invalid_input", "Amount must be a positive whole number of kobo");
      if (input.recipientCode.length === 0) return fail("invalid_input", "Recipient is required");
      const res = await call("POST", "/transfer", {
        source: "balance",
        amount: input.amountKobo,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason,
        currency: "NGN",
      });
      return res.ok ? readTransfer(res.data) : res;
    },

    async verifyTransfer(reference) {
      if (!isValidTransferReference(reference)) return fail("invalid_input", "Reference is not a valid transfer reference");
      const res = await call("GET", `/transfer/verify/${encodeURIComponent(reference)}`);
      return res.ok ? readTransfer(res.data) : res;
    },

    async parseWebhook(rawBody, signatureHeader) {
      if (!signatureHeader) return fail("invalid_signature", "Signature is missing", false);
      const expected = await hmacHex("SHA-512", webhookSecret, rawBody);
      if (!constantTimeEqual(signatureHeader.toLowerCase(), expected)) return fail("invalid_signature", "Signature does not match", false);
      return parsePaystackWebhookBody(rawBody);
    },
  };
}

/** Parses a webhook body AFTER its signature has been checked, into our event. Never throws. */
export function parsePaystackWebhookBody(rawBody: string): ProviderResult<PaymentEvent> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return bad("webhook body");
  }
  const root = asObject(json);
  const eventType = str(root?.["event"]);
  const data = asObject(root?.["data"]);
  if (!eventType || !data) return bad("webhook body");
  return ok(normaliseEvent(eventType, data));
}

/** Paystack events carry no id of their own, so the key is the event type plus the reference they are about. */
function normaliseEvent(eventType: string, data: Record<string, unknown>): PaymentEvent {
  const reference = str(data["reference"]) ?? str(data["transaction_reference"]);
  const key = `${eventType}:${reference ?? (data["id"] === undefined ? "none" : String(data["id"]))}`;
  if (eventType === "charge.success" && reference) {
    const amountKobo = int(data["amount"]);
    const currency = str(data["currency"]);
    if (amountKobo !== null && currency) {
      return {
        kind: "charge_success",
        key,
        reference,
        amountKobo,
        currency,
        paidAt: str(data["paid_at"]),
        customerEmail: str(asObject(data["customer"])?.["email"]),
        metadata: asObject(data["metadata"]) ?? {},
      };
    }
  }
  if (eventType.startsWith("refund.") && reference) {
    return { kind: "refund", key, reference, status: toRefundStatus(str(data["status"]) ?? eventType.slice("refund.".length)) };
  }
  if (eventType.startsWith("transfer.") && reference) {
    return { kind: "transfer", key, reference, transferCode: str(data["transfer_code"]), status: toTransferStatus(str(data["status"]) ?? eventType.slice("transfer.".length)) };
  }
  return { kind: "unknown", key, eventType };
}
