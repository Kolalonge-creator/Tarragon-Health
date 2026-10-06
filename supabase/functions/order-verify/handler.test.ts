// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleVerify, type VerifyDeps } from "./handler.ts";
import { supabaseOrderStore } from "../_shared/commerce/index.ts";
import { createMockPayment } from "../_shared/integrations/payment-mock.ts";

const REF = "tho_0123456789abcdef0123456789abcdef";
const req = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer t" }, method = "POST") =>
  new Request("https://x.test/order-verify", { method, headers, ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

async function setup(opts: { state?: string; owner?: boolean; settle?: boolean } = {}) {
  const payments = createMockPayment();
  await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 500_000, metadata: { kind: "order" } });
  if (opts.settle) payments.settle(REF, "success");
  const db = { state: opts.state ?? "created", recorded: 0 };
  const deps: VerifyDeps = {
    commerce: {
      payments,
      store: supabaseOrderStore({
        rpc: () => {
          if (db.state === "paid") return Promise.resolve({ data: { result: "replay", order_id: "o1" }, error: null });
          db.state = "paid";
          db.recorded++;
          return Promise.resolve({ data: { result: "paid", order_id: "o1" }, error: null });
        },
      }),
    },
    rpcAsUser: () => Promise.resolve({ data: opts.owner === false ? null : { state: db.state }, error: null }),
  };
  return { deps, db, payments };
}

Deno.test("a paid-at-Paystack order is confirmed and reported paid; asking again records nothing new", async () => {
  const { deps, db } = await setup({ settle: true });
  const r1 = await handleVerify(req({ reference: REF }), deps);
  assertEquals(await r1.json(), { state: "paid", outcome: "paid" });
  const r2 = await handleVerify(req({ reference: REF }), deps);
  assertEquals((await r2.json()).state, "paid");
  assertEquals(db.recorded, 1);
});

Deno.test("a browser return alone proves nothing: an unpaid order stays created", async () => {
  const { deps, db } = await setup();
  const r = await handleVerify(req({ reference: REF }), deps);
  assertEquals(await r.json(), { state: "created", outcome: "pending" });
  assertEquals(db.recorded, 0);
});

Deno.test("only the owner can ask: someone else's order is 404 and Paystack is not asked", async () => {
  const { deps, db } = await setup({ settle: true, owner: false });
  assertEquals((await handleVerify(req({ reference: REF }), deps)).status, 404);
  assertEquals(db.recorded, 0);
});

Deno.test("input and auth rules", async () => {
  const { deps } = await setup();
  assertEquals((await handleVerify(req({}, {}), deps)).status, 401);
  assertEquals((await handleVerify(req(null, {}, "GET"), deps)).status, 405);
  assertEquals((await handleVerify(req("nope"), deps)).status, 400);
  assertEquals((await handleVerify(req({ reference: "x" }), deps)).status, 400);
  assertEquals((await handleVerify(req({ reference: REF }), { ...deps, rpcAsUser: () => Promise.resolve({ data: null, error: { message: "bad jwt" } }) })).status, 401);
  assertEquals((await handleVerify(req({ reference: REF }), { ...deps, commerce: null })).status, 503);
});

Deno.test("an order already paid is answered without calling Paystack", async () => {
  const { deps } = await setup({ state: "paid" });
  assertEquals(await (await handleVerify(req({ reference: REF }), { ...deps, commerce: null })).json(), { state: "paid", outcome: "replay" });
});

Deno.test("a Paystack outage asks the app to try again", async () => {
  const { deps, payments } = await setup({ settle: true });
  payments.failNextCall();
  assertEquals((await handleVerify(req({ reference: REF }), deps)).status, 503);
});
