import { hmacHex } from "../../../../supabase/functions/_shared/integrations/crypto.ts";
import type { FetchLike } from "../../../../supabase/functions/_shared/integrations/http.ts";

/**
 * A small simulator that answers with the response shapes in Paystack's published API reference (status/message/data
 * envelope, amounts in kobo, 404 for an unknown reference, 400 for a duplicate). It lets the real adapter run its
 * contract suite with no network and no key. It is NOT Paystack: the live run in S25 and S31 is what confirms the shapes.
 */
export interface FakePaystack {
  readonly fetch: FetchLike;
  readonly secretKey: string;
  readonly calls: { method: string; path: string; body: Record<string, unknown> | null; auth: string | undefined }[];
  settle(reference: string, status: "success" | "failed" | "abandoned"): void;
  settleTransfer(reference: string, status: "success" | "failed" | "reversed" | "otp"): void;
  signedWebhook(body: unknown): Promise<{ rawBody: string; signature: string }>;
  /** Signs the exact text given, for a body that is not JSON. */
  signedRaw(rawBody: string): Promise<{ rawBody: string; signature: string }>;
  /** Pass the processor fee on to the customer for this charge, as Paystack does when pass-through is on. */
  setCustomerFee(reference: string, feeKobo: number): void;
  failNextCall(): void;
}

const reply = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
const okEnv = (data: unknown, message = "ok") => reply(200, { status: true, message, data });
const errEnv = (status: number, message: string) => reply(status, { status: false, message });

export function createFakePaystack(secretKey = "sk_test_fake_key_for_contract_suite"): FakePaystack {
  const calls: FakePaystack["calls"] = [];
  const charges = new Map<string, { amount: number; email: string; status: string; paid_at: string | null; metadata: unknown; refunded: number; fee: number }>();
  const transfers = new Map<string, { amount: number; status: string; code: string }>();
  const recipients = new Set<string>();
  let failNext = false;
  let seq = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    if (failNext) {
      failNext = false;
      throw new TypeError("fetch failed");
    }
    const u = new URL(url);
    const path = u.pathname;
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method: init.method, path: path + u.search, body, auth: init.headers["Authorization"] });
    if (init.headers["Authorization"] !== `Bearer ${secretKey}`) return errEnv(401, "Invalid key");

    if (init.method === "POST" && path === "/transaction/initialize") {
      const ref = body?.["reference"] as string;
      if (charges.has(ref)) return errEnv(400, "Duplicate Transaction Reference");
      if (!Number.isInteger(body?.["amount"])) return errEnv(400, "Invalid Amount Sent");
      charges.set(ref, { amount: body?.["amount"] as number, email: body?.["email"] as string, status: "abandoned", paid_at: null, metadata: body?.["metadata"] ?? {}, refunded: 0, fee: 0 });
      return okEnv({ authorization_url: `https://checkout.paystack.com/${ref}`, access_code: `ac_${ref}`, reference: ref });
    }
    if (init.method === "GET" && path.startsWith("/transaction/verify/")) {
      const ref = decodeURIComponent(path.slice("/transaction/verify/".length));
      const c = charges.get(ref);
      if (!c) return errEnv(404, "Transaction reference not found");
      return okEnv({ reference: ref, status: c.status, amount: c.amount + c.fee, requested_amount: c.amount, fees: c.fee, currency: "NGN", paid_at: c.paid_at, customer: { email: c.email }, metadata: c.metadata });
    }
    if (init.method === "POST" && path === "/refund") {
      const c = charges.get(body?.["transaction"] as string);
      if (!c) return errEnv(404, "Transaction not found");
      if (c.status !== "success") return errEnv(400, "Transaction has not been paid");
      const amount = (body?.["amount"] as number | undefined) ?? c.amount - c.refunded;
      if (amount <= 0 || c.refunded + amount > c.amount) return errEnv(400, "Amount is greater than the amount available");
      c.refunded += amount;
      seq += 1;
      return okEnv({ id: 5000 + seq, status: "pending", transaction: { reference: body?.["transaction"] } });
    }
    if (init.method === "GET" && path === "/bank") {
      const all = [{ name: "Access Bank", code: "044" }, { name: "Guaranty Trust Bank", code: "058" }, { name: "", code: "999" }, { name: "Zenith Bank", code: "057" }];
      const start = Number(u.searchParams.get("next") ?? 0);
      const pageSize = 2;
      const next = start + pageSize < all.length ? String(start + pageSize) : null;
      return reply(200, { status: true, message: "Banks retrieved", data: all.slice(start, start + pageSize), meta: { next, previous: null, perPage: pageSize } });
    }
    if (init.method === "GET" && path === "/bank/resolve") {
      const n = u.searchParams.get("account_number");
      return n === "0000000000" ? errEnv(422, "Could not resolve account name") : okEnv({ account_number: n, account_name: "TEST ACCOUNT HOLDER" });
    }
    if (init.method === "POST" && path === "/transferrecipient") {
      const code = `RCP_${body?.["bank_code"]}_${body?.["account_number"]}`;
      recipients.add(code);
      return okEnv({ recipient_code: code });
    }
    if (init.method === "POST" && path === "/transfer") {
      const ref = body?.["reference"] as string;
      if (!recipients.has(body?.["recipient"] as string)) return errEnv(400, "Recipient specified is invalid");
      if (transfers.has(ref)) return errEnv(400, "Transfer reference already used");
      seq += 1;
      const t = { amount: body?.["amount"] as number, status: "pending", code: `TRF_${seq}` };
      transfers.set(ref, t);
      return okEnv({ reference: ref, transfer_code: t.code, amount: t.amount, status: t.status });
    }
    if (init.method === "GET" && path.startsWith("/transfer/verify/")) {
      const ref = decodeURIComponent(path.slice("/transfer/verify/".length));
      const t = transfers.get(ref);
      return t ? okEnv({ reference: ref, transfer_code: t.code, amount: t.amount, status: t.status }) : errEnv(404, "Transfer not found");
    }
    return errEnv(404, "Not found");
  };

  return {
    fetch: fetchImpl,
    secretKey,
    calls,
    settle(reference, status) {
      const c = charges.get(reference);
      if (!c) throw new Error("unknown reference");
      c.status = status;
      c.paid_at = status === "success" ? "2026-10-06T10:00:00.000Z" : null;
    },
    setCustomerFee(reference, feeKobo) {
      const c = charges.get(reference);
      if (!c) throw new Error("unknown reference");
      c.fee = feeKobo;
    },
    settleTransfer(reference, status) {
      const t = transfers.get(reference);
      if (!t) throw new Error("unknown reference");
      t.status = status;
    },
    async signedWebhook(body) {
      const rawBody = JSON.stringify(body);
      return { rawBody, signature: await hmacHex("SHA-512", secretKey, rawBody) };
    },
    async signedRaw(rawBody) {
      return { rawBody, signature: await hmacHex("SHA-512", secretKey, rawBody) };
    },
    failNextCall() {
      failNext = true;
    },
  };
}
