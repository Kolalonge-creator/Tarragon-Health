// S25: the v5 order branch of the Paystack webhook, through the real handleWebhookRequest.
// Run: deno test --no-config --allow-env=PAYSTACK_WEBHOOK_SECRET,TERMII_API_KEY,APP_BASE_URL order-branch.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleWebhookRequest } from "./handler.ts";
import type { DepsFactory } from "./order-branch.ts";
import { supabaseOrderStore, type RpcClient } from "../_shared/commerce/index.ts";
import { createMockPayment } from "../_shared/integrations/payment-mock.ts";
import { FakeSupabaseClient } from "./test-fake-supabase.ts";

const REF = "tho_0123456789abcdef0123456789abcdef";
const PRICE = 500_000;

/** A database stand-in for the service-role writers: one order, idempotent exactly as record_order_payment is. */
function rpcDb() {
  const state = { paid: false, entitlements: 0, calls: [] as string[], failRecord: false };
  const client: RpcClient = {
    rpc: (fn, args = {}) => {
      state.calls.push(fn);
      if (fn === "record_order_payment") {
        if (state.failRecord) return Promise.resolve({ data: null, error: { message: "db down" } });
        if (state.paid) return Promise.resolve({ data: { result: "replay", order_id: "o1" }, error: null });
        if (args.p_amount_kobo !== PRICE) return Promise.resolve({ data: { result: "mismatch", reason: "amount", order_id: "o1" }, error: null });
        state.paid = true;
        state.entitlements++;
        return Promise.resolve({ data: { result: "paid", order_id: "o1" }, error: null });
      }
      return Promise.resolve({ data: { result: "mismatch", reason: String(args.p_reason), order_id: "o1" }, error: null });
    },
  };
  return { state, client };
}

async function post(body: string, signature: string, deps: DepsFactory | undefined, fake = new FakeSupabaseClient({ payment_transactions: { uniqueOn: [["provider", "provider_event_id"]] } })) {
  const res = await handleWebhookRequest(
    new Request("https://x.test/paystack-webhook", { method: "POST", body, headers: { "x-paystack-signature": signature } }),
    // deno-lint-ignore no-explicit-any
    fake as any,
    deps,
  );
  return { res, fake };
}

async function fixture() {
  const payments = createMockPayment();
  Deno.env.set("PAYSTACK_WEBHOOK_SECRET", payments.secret);
  await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: PRICE, metadata: { kind: "order", order_id: "o1" } });
  const db = rpcDb();
  const factory: DepsFactory = () => ({ payments, store: supabaseOrderStore(db.client) });
  return { payments, db, factory };
}

Deno.test("a paid order is recorded once however many times Paystack delivers it, and never touches payment_transactions", async () => {
  const { payments, db, factory } = await fixture();
  payments.settle(REF, "success");
  const { rawBody, signature } = await payments.signedChargeWebhook(REF);
  const answers: unknown[] = [];
  let fake: FakeSupabaseClient | undefined;
  for (let i = 0; i < 3; i++) {
    const r = await post(rawBody, signature, factory, fake);
    fake = r.fake;
    assertEquals(r.res.status, 200);
    answers.push((await r.res.json()).order);
  }
  assertEquals(answers, ["paid", "replay", "replay"]);
  assertEquals(db.state.entitlements, 1);
  assertEquals(fake!.rows("payment_transactions").length, 0);
});

Deno.test("a body that says paid for a charge Paystack still calls pending is answered 500 so Paystack retries, and pays nothing", async () => {
  const { payments, db, factory } = await fixture();
  const forged = await payments.signedWebhook({ event: "charge.success", data: { reference: REF, amount: PRICE, requested_amount: PRICE, fees: 0, currency: "NGN", metadata: { kind: "order" } } });
  const { res } = await post(forged.rawBody, forged.signature, factory);
  assertEquals(res.status, 500);
  assertEquals(db.state.entitlements, 0);
});

Deno.test("a database failure is answered 500 so the payment is retried, and the retry succeeds", async () => {
  const { payments, db, factory } = await fixture();
  payments.settle(REF, "success");
  const { rawBody, signature } = await payments.signedChargeWebhook(REF);
  db.state.failRecord = true;
  assertEquals((await post(rawBody, signature, factory)).res.status, 500);
  db.state.failRecord = false;
  const retry = await post(rawBody, signature, factory);
  assertEquals(retry.res.status, 200);
  assertEquals((await retry.res.json()).order, "paid");
});

Deno.test("a payment for the wrong price is recorded as a mismatch (200, an incident is opened by the database) and pays nothing", async () => {
  const payments = createMockPayment();
  Deno.env.set("PAYSTACK_WEBHOOK_SECRET", payments.secret);
  await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: PRICE - 1, metadata: { kind: "order" } });
  payments.settle(REF, "success");
  const db = rpcDb();
  const { rawBody, signature } = await payments.signedChargeWebhook(REF);
  const { res } = await post(rawBody, signature, () => ({ payments, store: supabaseOrderStore(db.client) }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).order, "mismatch");
  assertEquals(db.state.entitlements, 0);
});

Deno.test("no Paystack key configured answers 500", async () => {
  const { payments } = await fixture();
  payments.settle(REF, "success");
  const { rawBody, signature } = await payments.signedChargeWebhook(REF);
  assertEquals((await post(rawBody, signature, () => null)).res.status, 500);
});

Deno.test("the order branch trusts the outer signature check (no second parse) and still pays only after Paystack's verify", async () => {
  const { payments, db } = await fixture();
  payments.settle(REF, "success");
  const { rawBody, signature } = await payments.signedChargeWebhook(REF);
  let parsed = 0;
  let verified = 0;
  const spy = {
    ...payments,
    parseWebhook: (...a: Parameters<typeof payments.parseWebhook>) => { parsed++; return payments.parseWebhook(...a); },
    verifyTransaction: (r: string) => { verified++; return payments.verifyTransaction(r); },
  };
  const { res } = await post(rawBody, signature, () => ({ payments: spy, store: supabaseOrderStore(db.client) }));
  assertEquals(res.status, 200);
  assertEquals(parsed, 0);
  assertEquals(verified, 1);
  assertEquals(db.state.entitlements, 1);
});

Deno.test("the idempotency key sent to the database is the adapter's own, so a redelivery is one payment", async () => {
  const { payments, db } = await fixture();
  payments.settle(REF, "success");
  const { rawBody, signature } = await payments.signedChargeWebhook(REF);
  const keys: unknown[] = [];
  const client = { rpc: (fn: string, args: Record<string, unknown> = {}) => { if (fn === "record_order_payment") keys.push(args.p_event_key); return db.client.rpc(fn, args); } };
  const factory: DepsFactory = () => ({ payments, store: supabaseOrderStore(client) });
  await post(rawBody, signature, factory);
  await post(rawBody, signature, factory);
  assertEquals(keys, [`charge.success:${REF}`, `charge.success:${REF}`]);
  assertEquals(db.state.entitlements, 1);
});

Deno.test("a bad signature never reaches the order branch", async () => {
  const { payments, db, factory } = await fixture();
  payments.settle(REF, "success");
  const { rawBody } = await payments.signedChargeWebhook(REF);
  const { res } = await post(rawBody, "deadbeef", factory);
  assertEquals((await res.json()).error, "invalid_signature");
  assertEquals(db.state.calls.length, 0);
});

Deno.test("a legacy kind is not claimed by the order branch", async () => {
  const { payments, db, factory } = await fixture();
  const legacy = await payments.signedWebhook({ event: "charge.success", data: { reference: "svc_ref_123456", amount: 1000, currency: "NGN", metadata: { kind: "service_purchase" } } });
  const { fake } = await post(legacy.rawBody, legacy.signature, factory);
  assertEquals(db.state.calls.length, 0);
  assert(fake.rows("payment_transactions").length === 1);
});

Deno.test("a verified payment for a reference we have no order for is never acknowledged quietly", async () => {
  const { payments, factory } = await fixture();
  payments.settle(REF, "success");
  const { rawBody, signature } = await payments.signedChargeWebhook(REF);
  const notFound: DepsFactory = (db) => ({ ...factory(db)!, store: supabaseOrderStore({ rpc: () => Promise.resolve({ data: { result: "not_found" }, error: null }) }) });
  const { res } = await post(rawBody, signature, notFound);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "order_not_found");
});
