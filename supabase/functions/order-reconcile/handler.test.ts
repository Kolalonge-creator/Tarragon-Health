// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleReconcile, sameSecret } from "./handler.ts";
import { supabaseOrderStore } from "../_shared/commerce/index.ts";
import { createMockPayment } from "../_shared/integrations/payment-mock.ts";

const REF = "tho_0123456789abcdef0123456789abcdef";
const req = (secret?: string) => new Request("https://x.test/order-reconcile", { method: "POST", headers: secret ? { "x-order-reconcile-secret": secret } : {} });

Deno.test("fails closed without a configured secret and refuses a wrong or missing one", async () => {
  const payments = createMockPayment();
  const commerce = { payments, store: supabaseOrderStore({ rpc: () => Promise.resolve({ data: [], error: null }) }) };
  assertEquals((await handleReconcile(req("s"), { secret: null, commerce })).status, 503);
  assertEquals((await handleReconcile(req("wrong"), { secret: "s", commerce })).status, 401);
  assertEquals((await handleReconcile(req(), { secret: "s", commerce })).status, 401);
  assertEquals((await handleReconcile(req("s"), { secret: "s", commerce: null })).status, 503);
  assertEquals(sameSecret("a", "ab"), false);
});

Deno.test("pays a late settlement it finds and reports the pass", async () => {
  const payments = createMockPayment();
  await payments.initializeTransaction({ reference: REF, email: "a@example.com", amountKobo: 500_000, metadata: { kind: "order" } });
  payments.settle(REF, "success");
  const store = supabaseOrderStore({
    rpc: (fn) =>
      Promise.resolve(fn === "orders_needing_reconcile"
        ? { data: [{ reference: REF, order_id: "o1", expired: false }], error: null }
        : { data: { result: "paid", order_id: "o1" }, error: null }),
  });
  const r = await handleReconcile(req("s"), { secret: "s", commerce: { payments, store } });
  assertEquals(await r.json(), { checked: 1, paid: 1, closed: 0, mismatches: 0, stillPending: 0, errors: 0 });
});

Deno.test("a database failure listing orders answers 500", async () => {
  const payments = createMockPayment();
  const store = supabaseOrderStore({ rpc: () => Promise.resolve({ data: null, error: { message: "down" } }) });
  assertEquals((await handleReconcile(req("s"), { secret: "s", commerce: { payments, store } })).status, 500);
});
