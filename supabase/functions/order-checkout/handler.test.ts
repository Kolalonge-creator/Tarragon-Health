// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleCheckout, type CheckoutDeps } from "./handler.ts";
import { supabaseOrderStore } from "../_shared/commerce/index.ts";
import { createMockPayment } from "../_shared/integrations/payment-mock.ts";

const REF = "tho_0123456789abcdef0123456789abcdef";
const KEY = "11111111-2222-4333-8444-555555555555";

function deps(over: Partial<CheckoutDeps> & { rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null } } = {}) {
  const payments = createMockPayment();
  const seen: { amount?: unknown; args?: Record<string, unknown> } = {};
  const store = supabaseOrderStore({ rpc: () => Promise.resolve({ data: true, error: null }) });
  const d: CheckoutDeps = {
    payments,
    store,
    returnUrl: "https://app.example/patient/membership/paid",
    whoami: () => Promise.resolve({ id: "u1", email: "a@example.com" }),
    rpcAsUser: (_a, fn, args) => {
      seen.args = args;
      return Promise.resolve(over.rpc ? over.rpc(fn, args) : { data: { order_id: "o1", reference: REF, amount_kobo: 10_000_000, state: "created", checkout_url: null }, error: null });
    },
    ...over,
  };
  return { d, payments, seen };
}
const req = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer t" }, method = "POST") =>
  new Request("https://x.test/order-checkout", { method, headers, ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

Deno.test("creates the order as the patient and returns the hosted checkout link for the order's own price", async () => {
  const { d, payments, seen } = deps();
  const res = await handleCheckout(req({ code: "membership_annual", client_key: KEY }), d);
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals([j.order_id, j.amount_kobo, j.reference], ["o1", 10_000_000, REF]);
  assertEquals(seen.args, { p_code: "membership_annual", p_client_key: KEY });
  const v = await payments.verifyTransaction(REF);
  assertEquals(v.ok && v.data.requestedAmountKobo, 10_000_000);
});

Deno.test("an amount or a return URL sent by the client is ignored", async () => {
  const { d, payments } = deps();
  const res = await handleCheckout(req({ code: "membership_annual", client_key: KEY, amount_kobo: 1, callback_url: "https://evil.example" }), d);
  assertEquals(res.status, 200);
  const v = await payments.verifyTransaction(REF);
  assertEquals(v.ok && v.data.requestedAmountKobo, 10_000_000);
});

Deno.test("refuses without a token, with a bad token, a wrong method, bad input", async () => {
  const { d } = deps();
  assertEquals((await handleCheckout(req({}, {}), d)).status, 401);
  assertEquals((await handleCheckout(req({ code: "x", client_key: KEY }), { ...d, whoami: () => Promise.resolve(null) })).status, 401);
  assertEquals((await handleCheckout(req(null, {}, "GET"), d)).status, 405);
  assertEquals((await handleCheckout(req("not json"), d)).status, 400);
  assertEquals((await handleCheckout(req({ code: "Bad Code!", client_key: KEY }), d)).status, 400);
  assertEquals((await handleCheckout(req({ code: "membership_annual", client_key: "nope" }), d)).status, 400);
  assertEquals((await handleCheckout(req(null), d)).status, 400);
});

Deno.test("maps the database's refusals to stable codes", async () => {
  for (const [msg, status, code] of [["checkout_not_open", 409, "checkout_not_open"], ["no_capacity", 409, "no_capacity"], ["too_many_open_orders", 429, "too_many_open_orders"], ["something else", 500, "unknown"]] as const) {
    const { d } = deps({ rpc: () => ({ data: null, error: { message: msg } }) });
    const res = await handleCheckout(req({ code: "membership_annual", client_key: KEY }), d);
    assertEquals([res.status, (await res.json()).error], [status, code]);
  }
});

Deno.test("needs an email, and says so when payments are not configured", async () => {
  const { d } = deps({ whoami: () => Promise.resolve({ id: "u1", email: null }) });
  const r = await handleCheckout(req({ code: "membership_annual", client_key: KEY }), d);
  assertEquals([r.status, (await r.json()).error], [422, "email_needed"]);
  assertEquals((await handleCheckout(req({ code: "membership_annual", client_key: KEY }), { ...d, payments: null })).status, 503);
  assertEquals((await handleCheckout(req({ code: "membership_annual", client_key: KEY }), { ...d, returnUrl: null })).status, 503);
});

Deno.test("a strange reply from create_order is an error, not a payment", async () => {
  const { d } = deps({ rpc: () => ({ data: { nope: 1 }, error: null }) });
  assertEquals((await handleCheckout(req({ code: "membership_annual", client_key: KEY }), d)).status, 500);
});

Deno.test("an order that is already paid is refused", async () => {
  const { d } = deps({ rpc: () => ({ data: { order_id: "o1", reference: REF, amount_kobo: 1, state: "paid" }, error: null }) });
  const r = await handleCheckout(req({ code: "membership_annual", client_key: KEY }), d);
  assertEquals([r.status, (await r.json()).error], [409, "already_paid"]);
});

// S29: pay for a loved one
const PATIENT = "99999999-8888-4777-8666-555555555555";

Deno.test("S29: a beneficiary is passed to create_order and the payer's own email is used", async () => {
  const { d, seen } = deps();
  const res = await handleCheckout(req({ code: "membership_annual", client_key: KEY, beneficiary: PATIENT }), d);
  assertEquals(res.status, 200);
  assertEquals(seen.args, { p_code: "membership_annual", p_client_key: KEY, p_beneficiary: PATIENT });
});

Deno.test("S29: no beneficiary means no p_beneficiary argument (a patient paying for themselves is unchanged)", async () => {
  const { d, seen } = deps();
  await handleCheckout(req({ code: "membership_annual", client_key: KEY, beneficiary: null }), d);
  assertEquals(seen.args, { p_code: "membership_annual", p_client_key: KEY });
});

Deno.test("S29: a malformed beneficiary is refused before anything is created", async () => {
  const { d, seen } = deps();
  for (const bad of ["nope", 42, {}, "99999999-8888-4777-8666-55555555555"]) {
    const res = await handleCheckout(req({ code: "membership_annual", client_key: KEY, beneficiary: bad }), d);
    assertEquals(res.status, 400);
  }
  assertEquals(seen.args, undefined);
});

Deno.test("S29: the database refusing a payer (no pay_for_care, expired, another patient) is a 403 with a stable code", async () => {
  const { d } = deps({ rpc: () => ({ data: null, error: { message: "order_beneficiary_not_allowed" } }) });
  const res = await handleCheckout(req({ code: "membership_annual", client_key: KEY, beneficiary: PATIENT }), d);
  assertEquals([res.status, (await res.json()).error], [403, "order_beneficiary_not_allowed"]);
});

Deno.test("S29c: paying for someone else with anything but the full yearly Membership is a 403 with its own code", async () => {
  const { d } = deps({ rpc: () => ({ data: null, error: { message: "gift_item_not_allowed" } }) });
  const res = await handleCheckout(req({ code: "consult_single", client_key: KEY, beneficiary: PATIENT }), d);
  assertEquals([res.status, (await res.json()).error], [403, "gift_item_not_allowed"]);
});
