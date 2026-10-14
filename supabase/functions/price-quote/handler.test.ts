// Run: deno test --no-config .
import { assertEquals } from "jsr:@std/assert@1";
import { handleQuote, type QuoteDeps } from "./handler.ts";

const QUOTE = {
  item_code: "membership_annual", item_kind: "membership", currency: "NGN", list_kobo: 10_000_000, sponsor_share_kobo: 0, discount_kobo: 1_000_000,
  points_applied: 0, points_reduction_kobo: 0, discount_code_ok: true, amount_due_kobo: 9_000_000,
  lines: [
    { rule: "list", label_key: "quote.line.list", amount_kobo: 10_000_000, running_kobo: 10_000_000, applied: true, reason_key: null },
    { rule: "discount_code", label_key: "quote.line.discount_code", amount_kobo: -1_000_000, running_kobo: 9_000_000, applied: true, reason_key: null },
  ],
};

function deps(over: Partial<QuoteDeps> & { rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null } } = {}) {
  const seen: { fn?: string; args?: Record<string, unknown> } = {};
  const d: QuoteDeps = {
    whoami: () => Promise.resolve({ id: "u1" }),
    rpcAsUser: (_a, fn, args) => {
      seen.fn = fn; seen.args = args;
      return Promise.resolve(over.rpc ? over.rpc(fn, args) : { data: QUOTE, error: null });
    },
    ...over,
  };
  return { d, seen };
}
const req = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer t" }, method = "POST") =>
  new Request("https://x.test/price-quote", { method, headers, ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });

Deno.test("asks the database as the patient and returns its explanation, sending no amount", async () => {
  const { d, seen } = deps();
  const res = await handleQuote(req({ code: "membership_annual", discount_code: " welcome-26 ", use_points: true, amount_kobo: 1 }), d);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).amount_due_kobo, 9_000_000);
  assertEquals(seen.fn, "price_quote");
  assertEquals(seen.args, { p_code: "membership_annual", p_discount_code: "welcome-26", p_use_points: true });
});

Deno.test("sends only what was given", async () => {
  const { d, seen } = deps();
  await handleQuote(req({ code: "membership_annual" }), d);
  assertEquals(seen.args, { p_code: "membership_annual" });
});

Deno.test("refuses without a token, a bad token, a wrong method and bad input", async () => {
  const { d } = deps();
  assertEquals((await handleQuote(req({}, {}), d)).status, 401);
  assertEquals((await handleQuote(req({ code: "membership_annual" }), { ...d, whoami: () => Promise.resolve(null) })).status, 401);
  assertEquals((await handleQuote(req(null, {}, "GET"), d)).status, 405);
  assertEquals((await handleQuote(req("not json"), d)).status, 400);
  assertEquals((await handleQuote(req({ code: "Bad Code!" }), d)).status, 400);
  assertEquals((await handleQuote(req({ code: "membership_annual", beneficiary: "nope" }), d)).status, 400);
  assertEquals((await handleQuote(req({ code: "membership_annual", discount_code: "x" }), d)).status, 400);
  assertEquals((await handleQuote(req({ code: "membership_annual", use_points: "yes" }), d)).status, 400);
});

Deno.test("maps the database's refusals to stable codes", async () => {
  for (const [message, code, status] of [
    ["checkout_not_open", "checkout_not_open", 409], ["membership_not_open", "membership_not_open", 409],
    ["order_beneficiary_not_allowed", "order_beneficiary_not_allowed", 403], ["something odd", "unknown", 500],
  ] as const) {
    const { d } = deps({ rpc: () => ({ data: null, error: { message } }) });
    const res = await handleQuote(req({ code: "membership_annual" }), d);
    assertEquals([res.status, (await res.json()).error], [status, code]);
  }
});

Deno.test("a reply whose lines do not add up to the amount due is never passed on", async () => {
  const bad = { ...QUOTE, amount_due_kobo: 8_000_000 };
  const { d } = deps({ rpc: () => ({ data: bad, error: null }) });
  assertEquals((await handleQuote(req({ code: "membership_annual" }), d)).status, 500);
  const { d: d2 } = deps({ rpc: () => ({ data: { nonsense: true }, error: null }) });
  assertEquals((await handleQuote(req({ code: "membership_annual" }), d2)).status, 500);
});
